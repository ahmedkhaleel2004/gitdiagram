import { REPOSITORY_TOO_LARGE_ERROR } from "./github";
import {
  MODEL_PRICING_UNAVAILABLE_ERROR,
  ModelPricingUnavailableError,
} from "./pricing";

/**
 * Marks a failure whose message came from (or describes a call to) the model
 * provider. Provider text can name the organization or the key behind a rate
 * limit, and generation errors are echoed to the client *and* persisted into
 * the public session audit. `normalizeGenerationError` uses this marker to
 * decide what is safe to show: a caller who supplied their own key sees the
 * real message, everyone else gets a generic one while the raw text stays in
 * the server log.
 *
 * It lives here rather than beside the provider client so that classifying an
 * error never depends on loading the OpenAI SDK.
 */
export class UpstreamProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UpstreamProviderError";
  }
}

export function rethrowAsUpstreamProviderError(error: unknown): never {
  // Cancellation and the route deadline are the app's own control flow, so they
  // must reach the route unchanged rather than be reported as provider faults.
  if (
    error instanceof UpstreamProviderError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    throw error;
  }

  throw new UpstreamProviderError(
    error instanceof Error ? error.message : "Model provider request failed.",
    { cause: error },
  );
}

const DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED_ERROR =
  "GitDiagram's default OpenAI key is temporarily unavailable because its upstream API quota is exhausted. I'm a solo student engineer running this free and open source, so please try again later or use your own OpenAI API key.";
const REDACTED_UPSTREAM_ERROR =
  "The AI provider returned an error while generating this diagram. Please retry.";

function isOpenAiQuotaExhaustedError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("insufficient_quota") ||
    (normalized.includes("exceeded your current quota") &&
      normalized.includes("billing"))
  );
}

export function normalizeGenerationError(params: {
  provider: string;
  apiKey?: string;
  message: string;
  error?: unknown;
}): { message: string; errorCode: string } {
  if (params.error instanceof ModelPricingUnavailableError) {
    return {
      message: MODEL_PRICING_UNAVAILABLE_ERROR,
      errorCode: "MODEL_PRICING_UNAVAILABLE",
    };
  }

  if (params.message === REPOSITORY_TOO_LARGE_ERROR) {
    return {
      message: params.message,
      errorCode: "TOKEN_LIMIT_EXCEEDED",
    };
  }

  if (
    params.provider === "openai" &&
    !params.apiKey &&
    isOpenAiQuotaExhaustedError(params.message)
  ) {
    return {
      message: DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED_ERROR,
      errorCode: "DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED",
    };
  }

  // Provider text describes whichever key made the call. On the server's own
  // key that can name the organization or its rate-limit state, and this
  // message is both streamed to the client and persisted into the public
  // session audit, where later visitors read it. A caller using their own key
  // is only shown their own account's error, which they need to act on.
  if (!params.apiKey?.trim() && params.error instanceof UpstreamProviderError) {
    return {
      message: REDACTED_UPSTREAM_ERROR,
      errorCode: "STREAM_FAILED",
    };
  }

  return {
    message: params.message,
    errorCode: "STREAM_FAILED",
  };
}
