import "server-only";

// Claude API list prices in USD per million tokens, shared by the video cost
// accounting (explainer/director.ts) and the /admin credit estimate
// (admin/claude-credit.ts). Cache writes cost 1.25× input for 5 minutes and 2×
// for an hour; cache reads have their own rate per model (0.1× input on most,
// 0.05× on Opus 5.5, 0.025× on Fable 5.1). Haiku 5.5 alone charges by prompt
// length: every rate is 5× on a prompt over 100,000 tokens. Checked 2026-10-07.

export interface ClaudePrice {
  input: number;
  output: number;
  cacheRead: number;
  /** Every rate is multiplied by `times` on a prompt over `over` tokens. */
  longPrompt?: { over: number; times: number };
}

const PRICES: Record<string, ClaudePrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    longPrompt: { over: 100_000, times: 5 },
  },
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

/** List-price cost in USD of the given tokens (one request's, for Haiku 5.5). */
export function claudeCostUsd(price: ClaudePrice, tokens: ClaudeTokens) {
  const cacheWrite5m = tokens.cacheWrite5m ?? 0;
  const cacheWrite1h = tokens.cacheWrite1h ?? 0;
  const cacheRead = tokens.cacheRead ?? 0;
  const prompt = tokens.input + cacheWrite5m + cacheWrite1h + cacheRead;
  const times =
    price.longPrompt && prompt > price.longPrompt.over
      ? price.longPrompt.times
      : 1;
  return (
    ((tokens.input * price.input +
      cacheWrite5m * price.input * 1.25 +
      cacheWrite1h * price.input * 2 +
      cacheRead * price.cacheRead +
      tokens.output * price.output) *
      times) /
    1_000_000
  );
}
