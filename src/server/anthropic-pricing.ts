import "server-only";

// Claude API list prices in USD per million tokens, shared by the video cost
// accounting (explainer/director.ts) and the /admin credit estimate
// (admin/claude-credit.ts). Cache writes cost 1.25× input for 5 minutes and 2×
// for an hour; cache reads have their own rate per model (0.1× input on most,
// 0.05× on Opus 5.5, 0.025× on Fable 5.1). Checked 2026-09-25.

export interface ClaudePrice {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, ClaudePrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

/** The most expensive model, for estimates that should err high. */
export const HIGHEST_CLAUDE_PRICE = PRICES["claude-fable-5-1"]!;

/**
 * A model's price. Dated, "-latest" or provider-prefixed ids
 * ("claude-opus-5-5-20260901", "anthropic/claude-opus-5-5") are priced as the
 * model they name; any other unknown id (a newer model) has no price.
 */
export function claudePrice(model: string): ClaudePrice | null {
  const id = model
    .trim()
    .toLowerCase()
    .split("/")
    .at(-1)!
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, "");
  return PRICES[id] ?? null;
}

export interface ClaudeTokens {
  /** Input tokens that neither wrote nor read the cache. */
  input: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  cacheRead?: number;
  output: number;
}

/** List-price cost in USD of the given tokens. */
export function claudeCostUsd(price: ClaudePrice, tokens: ClaudeTokens) {
  return (
    (tokens.input * price.input +
      (tokens.cacheWrite5m ?? 0) * price.input * 1.25 +
      (tokens.cacheWrite1h ?? 0) * price.input * 2 +
      (tokens.cacheRead ?? 0) * price.cacheRead +
      tokens.output * price.output) /
    1_000_000
  );
}
