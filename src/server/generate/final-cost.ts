import type {
  GenerationCostSummary,
  GenerationTokenUsage,
  GenerationStageUsage,
} from "~/features/diagram/cost";
import type { GenerationEstimateResult } from "./cost-estimate";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
  GRAPH_RETRY_INPUT_BUFFER_TOKENS,
} from "./generation-policy";
import {
  combineCostSummaries,
  createCostSummary,
  sumGenerationUsage,
} from "./pricing";

export function createFinalGenerationCostSummary(params: {
  model: string;
  estimate: GenerationEstimateResult;
  actualUsages: GenerationTokenUsage[];
  stageUsages?: GenerationStageUsage[];
  hasCompleteMeasuredUsage: boolean;
  graphAttemptCount: number;
}): GenerationCostSummary {
  if (params.hasCompleteMeasuredUsage) {
    const measured = params.stageUsages
      ?.filter((stage) => stage.stage !== "estimate")
      .map((stage) => stage.costSummary);
    if (measured?.length) return combineCostSummaries(measured);
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
  const retryUsage: GenerationTokenUsage = {
    inputTokens: retryInputTokens * retryCount,
    outputTokens: GRAPH_MAX_OUTPUT_TOKENS * retryCount,
    totalTokens: (retryInputTokens + GRAPH_MAX_OUTPUT_TOKENS) * retryCount,
    cacheWriteTokens: retryInputTokens * retryCount,
  };
  return combineCostSummaries(
    [
      params.estimate.costSummary,
      createCostSummary({
        kind: "estimate",
        model: params.model,
        usage: retryUsage,
        approximate: true,
      }),
    ],
    `Provider usage was unavailable for at least one stage, so this remains a conservative estimate for ${graphAttemptCount} graph-planning attempt${graphAttemptCount === 1 ? "" : "s"}.`,
  );
}
