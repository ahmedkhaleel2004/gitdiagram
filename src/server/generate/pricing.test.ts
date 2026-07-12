import { describe, expect, it } from "vitest";

import {
  createEstimateCostSummary,
  estimateTextTokenCostUsd,
  normalizeGenerationUsage,
  resolvePricingModel,
} from "~/server/generate/pricing";

describe("resolvePricingModel", () => {
  it("keeps GPT-5.6 Terra on its own pricing tier", () => {
    expect(resolvePricingModel("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(resolvePricingModel("gpt-5.6-terra-2026-07-09")).toBe(
      "gpt-5.6-terra",
    );
  });

  it("prices the GPT-5.6 alias as Sol", () => {
    expect(resolvePricingModel("gpt-5.6")).toBe("gpt-5.6-sol");
  });

  it("maps OpenRouter model ids onto their underlying pricing tier", () => {
    expect(resolvePricingModel("openai/gpt-5.4")).toBe("gpt-5.4");
    expect(resolvePricingModel("openai/gpt-5.6-terra")).toBe("gpt-5.6-terra");
  });

  it("maps Atlas model ids onto their underlying pricing tier when prefixed", () => {
    expect(resolvePricingModel("deepseek-ai/DeepSeek-V3-0324")).toBe(
      "deepseek-v3-0324",
    );
  });
});

describe("estimateTextTokenCostUsd", () => {
  it("uses GPT-5.6 Terra pricing for cost estimates", () => {
    const result = estimateTextTokenCostUsd(
      "gpt-5.6-terra",
      1_000_000,
      1_000_000,
    );

    expect(result.pricingModel).toBe("gpt-5.6-terra");
    expect(result.pricing.inputPerMillionUsd).toBe(2.5);
    expect(result.pricing.outputPerMillionUsd).toBe(15);
    expect(result.costUsd).toBe(17.5);
  });
});

describe("normalizeGenerationUsage", () => {
  it("maps API usage fields into the shared token usage shape", () => {
    const result = normalizeGenerationUsage({
      input_tokens: 120,
      output_tokens: 80,
      total_tokens: 200,
      input_tokens_details: {
        cached_tokens: 30,
      },
      output_tokens_details: {
        reasoning_tokens: 12,
      },
    });

    expect(result).toEqual({
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      cachedInputTokens: 30,
      reasoningTokens: 12,
    });
  });
});

describe("createEstimateCostSummary", () => {
  it("returns an approximate estimate without multiplier-based math", () => {
    const result = createEstimateCostSummary({
      model: "gpt-5.6-terra",
      explanationInputTokens: 100,
      graphStaticInputTokens: 200,
      approximate: true,
    });

    expect(result.kind).toBe("estimate");
    expect(result.approximate).toBe(true);
    expect(result.usage.inputTokens).toBe(6_300);
    expect(result.usage.outputTokens).toBe(12_000);
    expect(result.note).toContain("configured output caps");
  });
});
