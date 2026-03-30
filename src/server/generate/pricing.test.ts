import { describe, expect, it } from "vitest";

import {
  createEstimateCostSummary,
  estimateTextTokenCostUsd,
  normalizeGenerationUsage,
  resolvePricingModel,
} from "~/server/generate/pricing";

describe("resolvePricingModel", () => {
  it("keeps gpt-5.4-mini on its own pricing tier", () => {
    expect(resolvePricingModel("gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(resolvePricingModel("gpt-5.4-mini-2026-03-17")).toBe("gpt-5.4-mini");
  });

  it("maps OpenRouter model ids onto their underlying pricing tier", () => {
    expect(resolvePricingModel("openai/gpt-5.4")).toBe("gpt-5.4");
    expect(resolvePricingModel("openai/gpt-5.4-mini")).toBe("gpt-5.4-mini");
  });
});

describe("estimateTextTokenCostUsd", () => {
  it("uses gpt-5.4-mini pricing for cost estimates", () => {
    const result = estimateTextTokenCostUsd("gpt-5.4-mini", 1_000_000, 1_000_000);

    expect(result.pricingModel).toBe("gpt-5.4-mini");
    expect(result.pricing.inputPerMillionUsd).toBe(0.75);
    expect(result.pricing.outputPerMillionUsd).toBe(4.5);
    expect(result.costUsd).toBe(5.25);
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
      model: "gpt-5.4-mini",
      explanationInputTokens: 100,
      graphStaticInputTokens: 200,
      approximate: true,
    });

    expect(result.kind).toBe("estimate");
    expect(result.approximate).toBe(true);
    expect(result.usage.inputTokens).toBe(12300);
    expect(result.usage.outputTokens).toBe(18000);
    expect(result.note).toContain("configured output caps");
  });
});
