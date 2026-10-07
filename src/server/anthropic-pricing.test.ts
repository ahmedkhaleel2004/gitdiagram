import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { claudeCostUsd, claudePrice } from "./anthropic-pricing";

describe("Claude prices", () => {
  it("prices dated and provider-prefixed ids as the model they name", () => {
    const opus = claudePrice("claude-opus-5-5");
    expect(opus).toEqual({ input: 4, output: 20, cacheRead: 0.2 });
    expect(claudePrice("claude-opus-5-5-20260901")).toBe(opus);
    expect(claudePrice("anthropic/claude-opus-5-5")).toBe(opus);
    expect(claudePrice(" Claude-Opus-5-5-latest ")).toBe(opus);
    // A shorter name is never read into a longer one's price, or back.
    expect(claudePrice("claude-opus-5")).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.5,
    });
    expect(claudePrice("claude-opus-5-6")).toBeNull();
    expect(claudePrice("gpt-6-sol")).toBeNull();
  });

  it("prices cache writes at 1.25× input for five minutes and 2× for an hour", () => {
    const price = claudePrice("claude-opus-5-5")!;
    expect(
      claudeCostUsd(price, {
        input: 1_000_000,
        cacheWrite5m: 1_000_000,
        cacheWrite1h: 1_000_000,
        cacheRead: 1_000_000,
        output: 1_000_000,
      }),
    ).toBeCloseTo(4 + 5 + 8 + 0.2 + 20);
  });

  it("prices Haiku 5.5 five times higher on a prompt over 100,000 tokens", () => {
    const price = claudePrice("claude-haiku-5-5")!;
    const short = { input: 20_000, cacheRead: 80_000, output: 1_000_000 };
    expect(claudeCostUsd(price, short)).toBeCloseTo(0.002 + 0.0008 + 0.5);
    expect(claudeCostUsd(price, { ...short, input: 20_001 })).toBeCloseTo(
      (0.0020001 + 0.0008 + 0.5) * 5,
    );
  });
});
