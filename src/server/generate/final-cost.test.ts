import { describe, expect, it } from "vitest";

import type { GenerationEstimateResult } from "./cost-estimate";
import { createFinalGenerationCostSummary } from "./final-cost";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
  GRAPH_RETRY_INPUT_BUFFER_TOKENS,
} from "./generation-policy";

function createEstimate(): GenerationEstimateResult {
  return {
    costSummary: {
      kind: "estimate",
      approximate: true,
      amountUsd: 0.01,
      display: "$0.010 USD",
      pricingModel: "gpt-5.6-terra",
      usage: {
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
      },
    },
    estimatedInputTokens: 1_000,
    estimatedOutputTokens: 500,
    pricingModel: "gpt-5.6-terra",
    pricing: {
      inputPerMillionUsd: 2.5,
      outputPerMillionUsd: 15,
    },
    explanationInputTokens: 400,
    graphStaticInputTokens: 300,
    graphRepairStaticInputTokens: 800,
  };
}

describe("createFinalGenerationCostSummary", () => {
  it("reports complete provider usage as actual", () => {
    const result = createFinalGenerationCostSummary({
      model: "gpt-5.6-terra",
      estimate: createEstimate(),
      actualUsages: [
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        { inputTokens: 200, outputTokens: 75, totalTokens: 275 },
      ],
      hasCompleteMeasuredUsage: true,
      graphAttemptCount: 1,
    });

    expect(result).toMatchObject({
      kind: "actual",
      approximate: false,
      usage: {
        inputTokens: 300,
        outputTokens: 125,
        totalTokens: 425,
      },
    });
  });

  it("keeps incomplete usage labeled as a conservative multi-attempt estimate", () => {
    const result = createFinalGenerationCostSummary({
      model: "gpt-5.6-terra",
      estimate: createEstimate(),
      actualUsages: [],
      hasCompleteMeasuredUsage: false,
      graphAttemptCount: 3,
    });
    const retryInputTokens =
      800 +
      EXPLANATION_MAX_OUTPUT_TOKENS +
      GRAPH_MAX_OUTPUT_TOKENS +
      GRAPH_RETRY_INPUT_BUFFER_TOKENS;

    expect(result).toMatchObject({
      kind: "estimate",
      approximate: true,
      usage: {
        inputTokens: 1_000 + retryInputTokens * 2,
        outputTokens: 500 + GRAPH_MAX_OUTPUT_TOKENS * 2,
      },
    });
    expect(result.note).toContain("3 graph-planning attempts");
  });

  it("uses the initial request estimate as a safe retry fallback", () => {
    const estimate = createEstimate();
    estimate.graphRepairStaticInputTokens = null;

    const result = createFinalGenerationCostSummary({
      model: "gpt-5.6-terra",
      estimate,
      actualUsages: [],
      hasCompleteMeasuredUsage: false,
      graphAttemptCount: 2,
    });

    expect(result.usage.inputTokens).toBe(
      1_000 + 1_000 + GRAPH_MAX_OUTPUT_TOKENS + GRAPH_RETRY_INPUT_BUFFER_TOKENS,
    );
    expect(result.kind).toBe("estimate");
  });
});
