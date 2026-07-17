import { toTaggedMessage } from "~/server/generate/format";
import {
  countInputTokens,
  estimateTokens,
  type ReasoningEffort,
} from "~/server/generate/openai";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  EXPLANATION_REASONING_EFFORT,
  GRAPH_MAX_OUTPUT_TOKENS,
  GRAPH_REASONING_EFFORT,
} from "~/server/generate/generation-policy";
import {
  createEstimateCostSummary,
  estimateTextTokenCostUsd,
} from "~/server/generate/pricing";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "~/server/generate/prompts";
import {
  type AIProvider,
  supportsExactInputTokenCount,
} from "~/server/generate/model-config";

interface CountPromptInputTokensParams {
  provider: AIProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
  preferExactInputTokenCount?: boolean;
  signal?: AbortSignal;
  clientRequestId?: string;
}

interface CountPromptInputTokensResult {
  inputTokens: number;
  usedFallback: boolean;
}

export interface GenerationEstimateResult {
  costSummary: ReturnType<typeof createEstimateCostSummary>;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  pricingModel: string;
  pricing: ReturnType<typeof estimateTextTokenCostUsd>["pricing"];
  explanationInputTokens: number;
  graphStaticInputTokens: number;
  graphRepairStaticInputTokens: number | null;
}

async function countPromptInputTokens({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
  preferExactInputTokenCount = true,
  signal,
  clientRequestId,
}: CountPromptInputTokensParams): Promise<CountPromptInputTokensResult> {
  signal?.throwIfAborted();

  if (!preferExactInputTokenCount || !supportsExactInputTokenCount(provider)) {
    return {
      inputTokens: estimateTokens(`${systemPrompt}\n${userPrompt}`),
      usedFallback: true,
    };
  }

  try {
    const inputTokens = await countInputTokens({
      provider,
      model,
      systemPrompt,
      userPrompt,
      apiKey,
      reasoningEffort,
      signal,
      clientRequestId,
    });

    return {
      inputTokens,
      usedFallback: false,
    };
  } catch {
    // Provider failures can safely fall back to the local estimate, but an
    // aborted request must stop all parallel token-count calls immediately.
    // Swallowing the abort here would let the cost route overrun its deadline.
    signal?.throwIfAborted();

    return {
      inputTokens: estimateTokens(`${systemPrompt}\n${userPrompt}`),
      usedFallback: true,
    };
  }
}

export async function estimateGenerationCost(params: {
  provider: AIProvider;
  model: string;
  fileTree: string;
  readme: string;
  username: string;
  repo: string;
  apiKey?: string;
  preferExactInputTokenCount?: boolean;
  includeGraphRepairInputTokens?: boolean;
  signal?: AbortSignal;
  clientRequestId?: string;
}): Promise<GenerationEstimateResult> {
  const explanationPrompt = toTaggedMessage({
    file_tree: params.fileTree,
    readme: params.readme,
  });
  const graphPromptWithoutExplanation = toTaggedMessage({
    explanation: "",
  });
  const graphRepairPromptWithoutExplanation = toTaggedMessage({
    explanation: "",
    file_tree: params.fileTree,
    previous_graph: "",
    validation_feedback: "",
  });

  const [explanationCount, graphStaticCount, graphRepairStaticCount] =
    await Promise.all([
      countPromptInputTokens({
        provider: params.provider,
        model: params.model,
        systemPrompt: SYSTEM_FIRST_PROMPT,
        userPrompt: explanationPrompt,
        apiKey: params.apiKey,
        reasoningEffort: EXPLANATION_REASONING_EFFORT,
        preferExactInputTokenCount: params.preferExactInputTokenCount,
        signal: params.signal,
        clientRequestId: params.clientRequestId
          ? `${params.clientRequestId}:explanation`
          : undefined,
      }),
      countPromptInputTokens({
        provider: params.provider,
        model: params.model,
        systemPrompt: SYSTEM_GRAPH_PROMPT,
        userPrompt: graphPromptWithoutExplanation,
        apiKey: params.apiKey,
        reasoningEffort: GRAPH_REASONING_EFFORT,
        preferExactInputTokenCount: params.preferExactInputTokenCount,
        signal: params.signal,
        clientRequestId: params.clientRequestId
          ? `${params.clientRequestId}:graph`
          : undefined,
      }),
      params.includeGraphRepairInputTokens
        ? countPromptInputTokens({
            provider: params.provider,
            model: params.model,
            systemPrompt: SYSTEM_GRAPH_PROMPT,
            userPrompt: graphRepairPromptWithoutExplanation,
            apiKey: params.apiKey,
            reasoningEffort: GRAPH_REASONING_EFFORT,
            preferExactInputTokenCount: params.preferExactInputTokenCount,
            signal: params.signal,
            clientRequestId: params.clientRequestId
              ? `${params.clientRequestId}:graph-repair`
              : undefined,
          })
        : Promise.resolve(null),
    ]);

  const noteParts = [
    "Estimate assumes one graph-planning attempt and the configured output caps.",
  ];
  if (
    explanationCount.usedFallback ||
    graphStaticCount.usedFallback ||
    graphRepairStaticCount?.usedFallback
  ) {
    noteParts.push(
      "Some input tokens were approximated with a conservative local fallback.",
    );
  }

  const costSummary = createEstimateCostSummary({
    model: params.model,
    explanationInputTokens: explanationCount.inputTokens,
    graphStaticInputTokens: graphStaticCount.inputTokens,
    approximate: true,
    note: noteParts.join(" "),
  });

  const { pricingModel, pricing } = estimateTextTokenCostUsd(
    params.model,
    costSummary.usage.inputTokens,
    costSummary.usage.outputTokens,
  );

  return {
    costSummary,
    estimatedInputTokens: costSummary.usage.inputTokens,
    estimatedOutputTokens:
      EXPLANATION_MAX_OUTPUT_TOKENS + GRAPH_MAX_OUTPUT_TOKENS,
    pricingModel,
    pricing,
    explanationInputTokens: explanationCount.inputTokens,
    graphStaticInputTokens: graphStaticCount.inputTokens,
    graphRepairStaticInputTokens: graphRepairStaticCount?.inputTokens ?? null,
  };
}
