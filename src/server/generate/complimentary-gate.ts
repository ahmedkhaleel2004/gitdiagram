import { MAX_GRAPH_ATTEMPTS } from "~/features/diagram/graph";
import {
  checkQuotaInUpstash,
  commitQuotaUsageInUpstash,
} from "~/server/storage/quota-store";
import type { AIProvider } from "~/server/generate/model-config";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
} from "~/server/generate/pricing";

const DEFAULT_DAILY_LIMIT_TOKENS = 10_000_000;
const DEFAULT_MODEL_FAMILY = "gpt-5.6-terra";
const COMPLIMENTARY_QUOTA_BUCKET = "openai-complimentary-small-models";
const RETRY_INPUT_BUFFER_TOKENS = 2_000;
const DEFAULT_DENIAL_MESSAGE =
  "GitDiagram's free daily OpenAI capacity is used up for now. I'm a solo student engineer running this free and open source, so please try again after 00:00 UTC or use your own OpenAI API key.";
const DEFAULT_PROVIDER_MISMATCH_MESSAGE =
  "GitDiagram's complimentary-only mode requires AI_PROVIDER=openai on the default server key. I'm a solo student engineer running this free and open source, so please switch the server back to OpenAI or use your own API key.";
const DEFAULT_MODEL_MISMATCH_MESSAGE =
  "GitDiagram's complimentary-only mode requires the gpt-5.6-terra model family on the default server key. I'm a solo student engineer running this free and open source, so please switch the server back to GPT-5.6 Terra or use your own API key.";

export interface ComplimentaryQuotaReservation {
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
  const explanationStageTokens = buildComplimentaryStageTokenBound(estimate, {
    stage: "explanation",
  });
  const firstGraphAttemptTokens = buildComplimentaryStageTokenBound(estimate, {
    stage: "graph",
    attempt: 1,
  });
  const retryGraphAttemptTokens = buildComplimentaryStageTokenBound(estimate, {
    stage: "graph",
    attempt: 2,
  });

  return (
    explanationStageTokens +
    firstGraphAttemptTokens +
    retryGraphAttemptTokens * Math.max(MAX_GRAPH_ATTEMPTS - 1, 0)
  );
}

/**
 * Returns the conservative token bound for the one provider request that is
 * currently in flight. This lets interrupted generations commit the current
 * stage without charging every graph retry that never ran.
 */
export function buildComplimentaryStageTokenBound(
  estimate: ComplimentaryAdmissionEstimate,
  stage: ComplimentaryGenerationStage,
): number {
  if (stage.stage === "explanation") {
    return estimate.explanationInputTokens + EXPLANATION_MAX_OUTPUT_TOKENS;
  }

  if (stage.attempt <= 1) {
    return (
      estimate.graphStaticInputTokens +
      EXPLANATION_MAX_OUTPUT_TOKENS +
      GRAPH_MAX_OUTPUT_TOKENS
    );
  }

  return (
    estimate.graphRepairStaticInputTokens +
    EXPLANATION_MAX_OUTPUT_TOKENS +
    GRAPH_MAX_OUTPUT_TOKENS +
    RETRY_INPUT_BUFFER_TOKENS +
    GRAPH_MAX_OUTPUT_TOKENS
  );
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
  const result = await checkQuotaInUpstash({
    quotaDateUtc,
    quotaBucket,
    tokenLimit: getComplimentaryDailyLimitTokens(),
    requestedTokens: params.requestedTokens,
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
  await commitQuotaUsageInUpstash({
    quotaDateUtc: params.reservation.quotaDateUtc,
    quotaBucket: params.reservation.quotaBucket,
    committedTokens: params.committedTokens,
    reservationTokens: params.reservation.reservedTokens,
  });
}
