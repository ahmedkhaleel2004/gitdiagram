import { toTaggedMessage } from "~/server/generate/format";
import {
  countInputTokens,
  estimateTokens,
  type ReasoningEffort,
} from "~/server/generate/openai";
import {
  createEstimateCostSummary,
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
  estimateTextTokenCostUsd,
} from "~/server/generate/pricing";
import { SYSTEM_FIRST_PROMPT, SYSTEM_GRAPH_PROMPT } from "~/server/generate/prompts";
import { type AIProvider, supportsExactInputTokenCount } from "~/server/generate/model-config";

interface CountPromptInputTokensParams {
  provider: AIProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
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
}

async function countPromptInputTokens({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
}: CountPromptInputTokensParams): Promise<CountPromptInputTokensResult> {
  if (!supportsExactInputTokenCount(provider)) {
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
    });

    return {
      inputTokens,
      usedFallback: false,
    };
  } catch {
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
}): Promise<GenerationEstimateResult> {
  const explanationPrompt = toTaggedMessage({
    file_tree: params.fileTree,
    readme: params.readme,
  });
  const graphPromptWithoutExplanation = toTaggedMessage({
    explanation: "",
    file_tree: params.fileTree,
    repo_owner: params.username,
    repo_name: params.repo,
    previous_graph: "",
    validation_feedback: "",
  });

  const [explanationCount, graphStaticCount] = await Promise.all([
    countPromptInputTokens({
      provider: params.provider,
      model: params.model,
      systemPrompt: SYSTEM_FIRST_PROMPT,
      userPrompt: explanationPrompt,
      apiKey: params.apiKey,
      reasoningEffort: "medium",
    }),
    countPromptInputTokens({
      provider: params.provider,
      model: params.model,
      systemPrompt: SYSTEM_GRAPH_PROMPT,
      userPrompt: graphPromptWithoutExplanation,
      apiKey: params.apiKey,
      reasoningEffort: "low",
    }),
  ]);

  const noteParts = [
    "Estimate assumes one graph-planning attempt and the configured output caps.",
  ];
  if (explanationCount.usedFallback || graphStaticCount.usedFallback) {
    noteParts.push("Some input tokens were approximated with the char/4 fallback.");
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
  };
}
