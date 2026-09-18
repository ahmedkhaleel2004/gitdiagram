import { describe, expect, it } from "vitest";

import {
  createEstimateCostSummary,
  createCostSummary,
  combineCostSummaries,
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

  it("does not substitute unrelated pricing for an unknown provider model", () => {
    expect(resolvePricingModel("anthropic/claude-opus-5")).toBeNull();
    expect(() =>
      estimateTextTokenCostUsd("anthropic/claude-opus-5", 1_000_000, 1_000_000),
    ).toThrow("Cost information is unavailable");
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
    expect(result.pricing.inputPerMillionUsd).toBe(2);
    expect(result.pricing.outputPerMillionUsd).toBe(12);
    expect(result.costUsd).toBe(14);
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
    expect(result.usage.inputTokens).toBe(8_300);
    expect(result.usage.outputTokens).toBe(14_000);
    expect(result.note).toContain(
      "estimated output usage; actual usage may be higher",
    );
  });
});

describe("mixed-model measured costs", () => {
  it("applies cache read discounts, cache write rates, and the returned tier", () => {
    const cost = createCostSummary({
      kind: "actual",
      model: "gpt-5.6-terra",
      approximate: false,
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        cachedInputTokens: 400,
        cacheWriteTokens: 200,
        serviceTier: "priority",
      },
    });
    // 400 ordinary at $2 + 400 reads at $0.20 + 200 writes at $2.50 + output at $12, then Fast 2x.
    expect(cost.amountUsd).toBeCloseTo(
      ((400 * 2 + 400 * 0.2 + 200 * 2.5 + 100 * 12) * 2) / 1e6,
      10,
    );
  });
  it("adds Terra analysis and Luna graph costs without repricing combined tokens", () => {
    const stage = (model: string) =>
      createCostSummary({
        kind: "actual",
        model,
        approximate: false,
        usage: { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 },
      });
    const total = combineCostSummaries([
      stage("gpt-5.6-terra"),
      stage("gpt-5.6-luna"),
    ]);
    expect(total.amountUsd).toBeCloseTo(0.0154, 10);
    expect(total.pricingModel).toBe("gpt-5.6-terra + gpt-5.6-luna");
    expect(total.usage.totalTokens).toBe(4000);
  });
  it("prices mixed-model estimates by stage with an uncached-write upper bound", () => {
    const total = createEstimateCostSummary({
      model: "gpt-5.6-luna",
      analysisModel: "gpt-5.6-terra",
      explanationInputTokens: 1000,
      graphStaticInputTokens: 200,
      approximate: true,
    });
    expect(total.amountUsd).toBeCloseTo(
      (1000 * 2.5 + 8000 * 12 + 8200 * 0.25 + 6000 * 1.2) / 1e6,
      10,
    );
  });
});
