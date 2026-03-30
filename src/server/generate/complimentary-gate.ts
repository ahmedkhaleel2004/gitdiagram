import { MAX_GRAPH_ATTEMPTS } from "~/features/diagram/graph";
import {
  finalizeQuotaInUpstash,
  reserveQuotaInUpstash,
} from "~/server/storage/quota-store";
import type { AIProvider } from "~/server/generate/model-config";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
  resolvePricingModel,
} from "~/server/generate/pricing";

const DEFAULT_DAILY_LIMIT_TOKENS = 10_000_000;
const DEFAULT_MODEL_FAMILY = "gpt-5.4-mini";
const RETRY_INPUT_BUFFER_TOKENS = 2_000;
const DEFAULT_DENIAL_MESSAGE =
  "GitDiagram's free daily OpenAI capacity is used up for now. I'm a solo student engineer running this free and open source, so please try again after 00:00 UTC or use your own OpenAI API key.";
const DEFAULT_PROVIDER_MISMATCH_MESSAGE =
  "GitDiagram's complimentary-only mode requires AI_PROVIDER=openai on the default server key. I'm a solo student engineer running this free and open source, so please either switch the server back to OpenAI mini or use your own API key.";
const DEFAULT_MODEL_MISMATCH_MESSAGE =
  "GitDiagram's complimentary-only mode requires the gpt-5.4-mini model family on the default server key. I'm a solo student engineer running this free and open source, so please switch the server back to OpenAI mini or use your own API key.";

export interface ComplimentaryQuotaReservation {
  quotaBucket: string;
  quotaDateUtc: string;
  quotaResetAt: string;
  reservedTokens: number;
}

export interface ComplimentaryReservationEstimate {
  explanationInputTokens: number;
  graphStaticInputTokens: number;
}

export interface ConservativeQuotaCommitEstimate {
  explanationInputTokens: number;
  graphStaticInputTokens: number;
}

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

export function isComplimentaryGateEnabled(): boolean {
  return readEnvFlag("OPENAI_COMPLIMENTARY_GATE_ENABLED");
}

export function getComplimentaryDailyLimitTokens(): number {
  return readEnvInt(
    "OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS",
    DEFAULT_DAILY_LIMIT_TOKENS,
  );
}

export function getComplimentaryModelFamily(): string {
  return resolvePricingModel(
    readEnvString("OPENAI_COMPLIMENTARY_MODEL_FAMILY", DEFAULT_MODEL_FAMILY),
  );
}

export function getComplimentaryQuotaDateUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function getComplimentaryQuotaResetAt(now = new Date()): string {
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
  model: string;
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
  return resolvePricingModel(model) === getComplimentaryModelFamily();
}

export function getComplimentaryQuotaBucket(model: string): string {
  return `openai:${resolvePricingModel(model)}:complimentary`;
}

export function buildComplimentaryReservationTokens(
  estimate: ComplimentaryReservationEstimate,
): number {
  const explanationStageTokens =
    estimate.explanationInputTokens + EXPLANATION_MAX_OUTPUT_TOKENS;
  const firstGraphAttemptTokens =
    estimate.graphStaticInputTokens +
    EXPLANATION_MAX_OUTPUT_TOKENS +
    GRAPH_MAX_OUTPUT_TOKENS;
  const retryGraphAttemptTokens =
    estimate.graphStaticInputTokens +
    EXPLANATION_MAX_OUTPUT_TOKENS +
    GRAPH_MAX_OUTPUT_TOKENS +
    RETRY_INPUT_BUFFER_TOKENS +
    GRAPH_MAX_OUTPUT_TOKENS;

  return (
    explanationStageTokens +
    firstGraphAttemptTokens +
    retryGraphAttemptTokens * Math.max(MAX_GRAPH_ATTEMPTS - 1, 0)
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

export function estimateConservativeCommittedTokens(params: {
  stage?: string;
  reservationTokens: number;
  estimate: ConservativeQuotaCommitEstimate;
  measuredTokens: number;
}): number {
  const explanationStageTokens =
    params.estimate.explanationInputTokens + EXPLANATION_MAX_OUTPUT_TOKENS;
  const firstGraphAttemptTokens =
    explanationStageTokens +
    params.estimate.graphStaticInputTokens +
    EXPLANATION_MAX_OUTPUT_TOKENS +
    GRAPH_MAX_OUTPUT_TOKENS;

  const stage = params.stage ?? "started";

  if (stage === "started") {
    return params.measuredTokens;
  }

  if (
    stage === "explanation_sent" ||
    stage === "explanation" ||
    stage === "explanation_chunk"
  ) {
    return Math.max(params.measuredTokens, explanationStageTokens);
  }

  if (stage === "graph_sent" || stage === "graph") {
    return Math.max(params.measuredTokens, firstGraphAttemptTokens);
  }

  return Math.max(params.measuredTokens, params.reservationTokens);
}

export async function reserveComplimentaryQuota(params: {
  model: string;
  reservationTokens: number;
  now?: Date;
}): Promise<
  | { admitted: true; reservation: ComplimentaryQuotaReservation }
  | { admitted: false; quotaResetAt: string; message: string }
> {
  const now = params.now ?? new Date();
  const quotaDateUtc = getComplimentaryQuotaDateUtc(now);
  const quotaResetAt = getComplimentaryQuotaResetAt(now);
  const quotaBucket = getComplimentaryQuotaBucket(params.model);
  const result = await reserveQuotaInUpstash({
    quotaDateUtc,
    quotaBucket,
    tokenLimit: getComplimentaryDailyLimitTokens(),
    reservationTokens: params.reservationTokens,
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
      reservedTokens: params.reservationTokens,
    },
  };
}

export async function finalizeComplimentaryQuota(params: {
  reservation: ComplimentaryQuotaReservation;
  committedTokens: number;
}): Promise<void> {
  await finalizeQuotaInUpstash({
    quotaDateUtc: params.reservation.quotaDateUtc,
    quotaBucket: params.reservation.quotaBucket,
    reservationTokens: params.reservation.reservedTokens,
    committedTokens: params.committedTokens,
  });
}
