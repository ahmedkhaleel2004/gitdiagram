import type {
  GenerationCostSummary,
  GenerationTokenUsage,
} from "~/features/diagram/cost";
import type { GenerationEstimateResult } from "./cost-estimate";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
  GRAPH_RETRY_INPUT_BUFFER_TOKENS,
} from "./generation-policy";
import { createCostSummary, sumGenerationUsage } from "./pricing";

export function createFinalGenerationCostSummary(params: {
  model: string;
  estimate: GenerationEstimateResult;
  actualUsages: GenerationTokenUsage[];
  hasCompleteMeasuredUsage: boolean;
  graphAttemptCount: number;
}): GenerationCostSummary {
  if (params.hasCompleteMeasuredUsage) {
    return createCostSummary({
      kind: "actual",
      model: params.model,
      usage: sumGenerationUsage(...params.actualUsages),
      approximate: false,
    });
  }

  const graphAttemptCount = Math.max(params.graphAttemptCount, 1);
  const retryCount = Math.max(graphAttemptCount - 1, 0);
  const baseUsage = params.estimate.costSummary.usage;
  const retryInputTokens =
    params.estimate.graphRepairStaticInputTokens !== null
      ? params.estimate.graphRepairStaticInputTokens +
        EXPLANATION_MAX_OUTPUT_TOKENS +
        GRAPH_MAX_OUTPUT_TOKENS +
        GRAPH_RETRY_INPUT_BUFFER_TOKENS
      : baseUsage.inputTokens +
        GRAPH_MAX_OUTPUT_TOKENS +
        GRAPH_RETRY_INPUT_BUFFER_TOKENS;
  const usage: GenerationTokenUsage = {
    inputTokens: baseUsage.inputTokens + retryInputTokens * retryCount,
    outputTokens: baseUsage.outputTokens + GRAPH_MAX_OUTPUT_TOKENS * retryCount,
    totalTokens: 0,
  };
  usage.totalTokens = usage.inputTokens + usage.outputTokens;

  return createCostSummary({
    kind: "estimate",
    model: params.model,
    usage,
    approximate: true,
    note: `Provider usage was unavailable for at least one stage, so this remains a conservative estimate for ${graphAttemptCount} graph-planning attempt${graphAttemptCount === 1 ? "" : "s"}.`,
  });
}
