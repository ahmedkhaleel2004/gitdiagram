/**
 * Real cost of one model call from its measured usage. Prices as published on
 * 2026-10-07 (USD per million tokens):
 * - GPT-6 Luna: 0.10 in / 0.50 out, cache read 0.1x, cache write 1.25x, and
 *   2x for the priority tier production uses (same rules as
 *   src/server/generate/pricing.ts).
 * - Claude Haiku 5.5: 0.10 in / 0.50 out while the whole prompt is at most
 *   100,000 tokens; 0.50 in / 2.50 out for the whole request above that.
 *   Cache reads 0.01 / 0.05, cache writes 1.25x input (OpenRouter's listing
 *   shows the same numbers and the same 100,000-token threshold).
 */
export interface CallUsage {
  model: string;
  /** Whole prompt, cached and cache-written tokens included. */
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  /** Includes reasoning/thinking tokens (both providers bill them as output). */
  outputTokens: number;
  reasoningTokens: number;
  serviceTier: string | null;
}

export const HAIKU_CLIFF_TOKENS = 100_000;

export function callCostUsd(usage: CallUsage): number {
  const plain = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
  );
  if (/haiku/.test(usage.model)) {
    const over = usage.inputTokens > HAIKU_CLIFF_TOKENS;
    const input = over ? 0.5 : 0.1;
    const output = over ? 2.5 : 0.5;
    const read = over ? 0.05 : 0.01;
    return (
      (plain * input +
        usage.cachedInputTokens * read +
        usage.cacheWriteTokens * input * 1.25 +
        usage.outputTokens * output) /
      1e6
    );
  }
  if (/gpt-6-luna/.test(usage.model)) {
    const tier =
      usage.serviceTier === "priority" || usage.serviceTier === "fast" ? 2 : 1;
    return (
      (tier *
        (plain * 0.1 +
          usage.cachedInputTokens * 0.01 +
          usage.cacheWriteTokens * 0.125 +
          usage.outputTokens * 0.5)) /
      1e6
    );
  }
  throw new Error(`no price for ${usage.model}`);
}
