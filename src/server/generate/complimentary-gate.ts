import { randomUUID } from "node:crypto";

import { MAX_GRAPH_ATTEMPTS } from "~/features/diagram/graph";
import {
  buildQuotaKey,
  checkQuotaInUpstash,
  commitQuotaUsageInUpstash,
  markQuotaReservationStartedInUpstash,
} from "~/server/storage/quota-store";
import { upstashCommand } from "~/server/storage/upstash";
import type { AIProvider } from "~/server/generate/model-config";
import {
  EXPLANATION_ESTIMATED_OUTPUT_TOKENS,
  GRAPH_ESTIMATED_OUTPUT_TOKENS,
  GRAPH_RETRY_INPUT_BUFFER_TOKENS,
} from "~/server/generate/pricing";

const DEFAULT_DAILY_LIMIT_TOKENS = 10_000_000;
const DEFAULT_MODEL_FAMILY = "gpt-6-luna";
const COMPLIMENTARY_QUOTA_BUCKET = "openai-complimentary-small-models";
const QUOTA_FINALIZATION_ATTEMPTS = 2;
const DEFAULT_DENIAL_MESSAGE =
  "GitDiagram's free daily OpenAI capacity is used up for now. I'm a solo student engineer running this free and open source, so please try again after 00:00 UTC or use your own OpenAI API key.";
const DEFAULT_PROVIDER_MISMATCH_MESSAGE =
  "GitDiagram's complimentary-only mode requires AI_PROVIDER=openai on the default server key. I'm a solo student engineer running this free and open source, so please switch the server back to OpenAI or use your own API key.";
const DEFAULT_MODEL_MISMATCH_MESSAGE =
  "GitDiagram's complimentary-only mode requires the configured complimentary model family on the default server key. Please use your own API key or try again later.";

export interface ComplimentaryQuotaReservation {
  reservationId: string;
  quotaBucket: string;
  quotaDateUtc: string;
  quotaResetAt: string;
  reservedTokens: number;
}

export interface ComplimentaryAdmissionEstimate {
  explanationInputTokens: number;
  graphStaticInputTokens: number;
  graphRepairStaticInputTokens: number;
}

export type ComplimentaryGenerationStage =
  { stage: "explanation" } | { stage: "graph"; attempt: number };

function readEnvFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function readEnvInt(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvString(name: string, fallback: string): string {
  return process.env[name]?.trim().toLowerCase() || fallback;
}

function normalizeModelFamily(model: string): string {
  const normalized = model.trim().toLowerCase();
  const withoutProvider = normalized.includes("/")
    ? (normalized.split("/").at(-1) ?? normalized)
    : normalized;
  return withoutProvider.replace(/-\d{4}-\d{2}-\d{2}$/i, "");
}

export function isComplimentaryGateEnabled(): boolean {
  return readEnvFlag("OPENAI_COMPLIMENTARY_GATE_ENABLED");
}

export function getComplimentaryDailyLimitTokens(): number {
  return readEnvInt(
    "OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS",
    DEFAULT_DAILY_LIMIT_TOKENS,
  );
}

function getComplimentaryModelFamily(): string {
  return normalizeModelFamily(
    readEnvString("OPENAI_COMPLIMENTARY_MODEL_FAMILY", DEFAULT_MODEL_FAMILY),
  );
}

function getComplimentaryQuotaDateUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function getComplimentaryQuotaResetAt(now = new Date()): string {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  ).toISOString();
}

export function shouldApplyComplimentaryGate(params: {
  provider: AIProvider;
  apiKey?: string;
}): boolean {
  if (!isComplimentaryGateEnabled()) {
    return false;
  }

  if (params.provider !== "openai") {
    return false;
  }

  return !params.apiKey;
}

export function modelMatchesComplimentaryFamily(model: string): boolean {
  return normalizeModelFamily(model) === getComplimentaryModelFamily();
}

export function getComplimentaryQuotaBucket(): string {
  return COMPLIMENTARY_QUOTA_BUCKET;
}

export function buildComplimentaryAdmissionTokens(
  estimate: ComplimentaryAdmissionEstimate,
): number {
  const explanationStageTokens = buildComplimentaryStageTokenEstimate(
    estimate,
    {
      stage: "explanation",
    },
  );
  const firstGraphAttemptTokens = buildComplimentaryStageTokenEstimate(
    estimate,
    {
      stage: "graph",
      attempt: 1,
    },
  );
  const retryGraphAttemptTokens = buildComplimentaryStageTokenEstimate(
    estimate,
    {
      stage: "graph",
      attempt: 2,
    },
  );

  return (
    explanationStageTokens +
    firstGraphAttemptTokens +
    retryGraphAttemptTokens * Math.max(MAX_GRAPH_ATTEMPTS - 1, 0)
  );
}

/**
 * Estimates usage for the provider request currently in flight when measured
 * usage is unavailable. This is not an output cap or a guaranteed upper bound.
 * Interrupted generations do not charge for graph retries that never ran.
 */
export function buildComplimentaryStageTokenEstimate(
  estimate: ComplimentaryAdmissionEstimate,
  stage: ComplimentaryGenerationStage,
): number {
  if (stage.stage === "explanation") {
    return (
      estimate.explanationInputTokens + EXPLANATION_ESTIMATED_OUTPUT_TOKENS
    );
  }

  if (stage.attempt <= 1) {
    return (
      estimate.graphStaticInputTokens +
      EXPLANATION_ESTIMATED_OUTPUT_TOKENS +
      GRAPH_ESTIMATED_OUTPUT_TOKENS
    );
  }

  return (
    estimate.graphRepairStaticInputTokens +
    EXPLANATION_ESTIMATED_OUTPUT_TOKENS +
    GRAPH_ESTIMATED_OUTPUT_TOKENS +
    GRAPH_RETRY_INPUT_BUFFER_TOKENS +
    GRAPH_ESTIMATED_OUTPUT_TOKENS
  );
}

/** Today's complimentary tokens: measured use, in-flight reservations, limit. */
export async function readComplimentaryUsageToday(): Promise<{
  enabled: boolean;
  usedTokens: number;
  reservedTokens: number;
  limitTokens: number;
}> {
  const [used, reserved] = await upstashCommand<Array<string | null>>([
    "HMGET",
    buildQuotaKey(
      getComplimentaryQuotaDateUtc(),
      getComplimentaryQuotaBucket(),
    ),
    "used_tokens",
    "reserved_tokens",
  ]);
  return {
    enabled: isComplimentaryGateEnabled(),
    usedTokens: Number(used) || 0,
    reservedTokens: Number(reserved) || 0,
    limitTokens: getComplimentaryDailyLimitTokens(),
  };
}

export function getComplimentaryDenialMessage(): string {
  return DEFAULT_DENIAL_MESSAGE;
}

export function getComplimentaryProviderMismatchMessage(): string {
  return DEFAULT_PROVIDER_MISMATCH_MESSAGE;
}

export function getComplimentaryModelMismatchMessage(): string {
  return DEFAULT_MODEL_MISMATCH_MESSAGE;
}
export async function admitComplimentaryQuota(params: {
  model: string;
  requestedTokens: number;
  now?: Date;
}): Promise<
  | { admitted: true; reservation: ComplimentaryQuotaReservation }
  | { admitted: false; quotaResetAt: string; message: string }
> {
  const now = params.now ?? new Date();
  const quotaDateUtc = getComplimentaryQuotaDateUtc(now);
  const quotaResetAt = getComplimentaryQuotaResetAt(now);
  const quotaBucket = getComplimentaryQuotaBucket();
  const reservationId = randomUUID();
  const result = await checkQuotaInUpstash({
    quotaDateUtc,
    quotaBucket,
    tokenLimit: getComplimentaryDailyLimitTokens(),
    requestedTokens: params.requestedTokens,
    reservationId,
  });

  if (!result.admitted) {
    return {
      admitted: false,
      quotaResetAt,
      message: getComplimentaryDenialMessage(),
    };
  }

  return {
    admitted: true,
    reservation: {
      reservationId,
      quotaBucket,
      quotaDateUtc,
      quotaResetAt,
      reservedTokens: params.requestedTokens,
    },
  };
}

export async function finalizeComplimentaryQuota(params: {
  reservation: ComplimentaryQuotaReservation;
  committedTokens: number;
}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= QUOTA_FINALIZATION_ATTEMPTS; attempt++) {
    try {
      await commitQuotaUsageInUpstash({
        quotaDateUtc: params.reservation.quotaDateUtc,
        quotaBucket: params.reservation.quotaBucket,
        committedTokens: params.committedTokens,
        reservationId: params.reservation.reservationId,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function markComplimentaryQuotaStarted(
  reservation: ComplimentaryQuotaReservation,
): Promise<void> {
  await markQuotaReservationStartedInUpstash({
    quotaDateUtc: reservation.quotaDateUtc,
    quotaBucket: reservation.quotaBucket,
    reservationId: reservation.reservationId,
  });
}
