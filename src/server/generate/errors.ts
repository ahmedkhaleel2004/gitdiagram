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

/**
 * Prefixed onto raw provider text shown to a caller who supplied their own API
 * key. Provider bodies can echo a masked key prefix/suffix or an organization
 * id, so while the caller may see their own account's error live over SSE, the
 * same message is also persisted into a shared failure record that later
 * visitors read. The prefix marks the message as raw provider text so
 * `redactUpstreamProviderTextForSharedRecord` can strip it at the persistence
 * boundary without a side channel.
 */
export const BYOK_UPSTREAM_ERROR_PREFIX = "Your AI provider key hit an error: ";

/**
 * Replaces raw provider text (marked by `BYOK_UPSTREAM_ERROR_PREFIX`) with the
 * generic upstream error before an audit is written to shared storage.
 * App-authored messages pass through untouched.
 */
export function redactUpstreamProviderTextForSharedRecord(
  message: string | undefined,
): string | undefined {
  if (message?.startsWith(BYOK_UPSTREAM_ERROR_PREFIX)) {
    return REDACTED_UPSTREAM_ERROR;
  }
  return message;
}

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
  // is shown their own account's error, which they need to act on — but the
  // message is tagged with `BYOK_UPSTREAM_ERROR_PREFIX` so the persistence
  // boundary keeps the raw provider text out of the shared failure record.
  if (params.error instanceof UpstreamProviderError) {
    if (!params.apiKey?.trim()) {
      return {
        message: REDACTED_UPSTREAM_ERROR,
        errorCode: "STREAM_FAILED",
      };
    }
    return {
      message: `${BYOK_UPSTREAM_ERROR_PREFIX}${params.message}`,
      errorCode: "STREAM_FAILED",
    };
  }

  return {
    message: params.message,
    errorCode: "STREAM_FAILED",
  };
}
