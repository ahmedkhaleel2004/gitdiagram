import type {
  GenerationCostSummary,
  GenerationTokenUsage,
} from "~/features/diagram/cost";

export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

interface RawResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export const EXPLANATION_MAX_OUTPUT_TOKENS = 4000;
export const GRAPH_MAX_OUTPUT_TOKENS = 6000;

const DEFAULT_PRICING_MODEL = "gpt-5.4-mini";

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.4": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 15.0 },
  "gpt-5.4-pro": { inputPerMillionUsd: 30.0, outputPerMillionUsd: 180.0 },
  "gpt-5.4-mini": { inputPerMillionUsd: 0.75, outputPerMillionUsd: 4.5 },
  "gpt-5.4-nano": { inputPerMillionUsd: 0.2, outputPerMillionUsd: 1.25 },

  // Retain pricing entries for older model ids that may still appear in stored data or requests.
  "gpt-5.2": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2-chat-latest": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2-codex": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2-pro": { inputPerMillionUsd: 21.0, outputPerMillionUsd: 168.0 },

  "gpt-5.1": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
  "gpt-5": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
  "gpt-5-mini": { inputPerMillionUsd: 0.25, outputPerMillionUsd: 2.0 },
  "gpt-5-nano": { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 },
  "o4-mini": { inputPerMillionUsd: 1.1, outputPerMillionUsd: 4.4 },
};
const DEFAULT_PRICING = MODEL_PRICING[DEFAULT_PRICING_MODEL] as ModelPricing;

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function stripDateSnapshotSuffix(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/i, "");
}

function stripProviderPrefix(model: string): string {
  return model.includes("/") ? model.split("/").at(-1) ?? model : model;
}

export function resolvePricingModel(model: string): string {
  const normalized = normalizeModelId(model);
  if (MODEL_PRICING[normalized]) return normalized;

  const withoutDate = stripDateSnapshotSuffix(stripProviderPrefix(normalized));
  if (MODEL_PRICING[withoutDate]) return withoutDate;

  if (withoutDate.startsWith("gpt-5.4-pro")) return "gpt-5.4-pro";
  if (withoutDate.startsWith("gpt-5.4-mini")) return "gpt-5.4-mini";
  if (withoutDate.startsWith("gpt-5.4-nano")) return "gpt-5.4-nano";
  if (withoutDate.startsWith("gpt-5.4")) return "gpt-5.4";
  if (withoutDate.startsWith("gpt-5.2-pro")) return "gpt-5.2-pro";
  if (withoutDate.startsWith("gpt-5.2-codex")) return "gpt-5.2-codex";
  if (withoutDate.startsWith("gpt-5.2-chat")) return "gpt-5.2-chat-latest";
  if (withoutDate.startsWith("gpt-5.2")) return "gpt-5.2";
  if (withoutDate.startsWith("gpt-5.1")) return "gpt-5.1";
  if (withoutDate.startsWith("gpt-5-mini")) return "gpt-5-mini";
  if (withoutDate.startsWith("gpt-5-nano")) return "gpt-5-nano";
  if (withoutDate.startsWith("gpt-5")) return "gpt-5";
  if (withoutDate.startsWith("o4-mini")) return "o4-mini";

  return DEFAULT_PRICING_MODEL;
}

export function estimateTextTokenCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; pricingModel: string; pricing: ModelPricing } {
  const pricingModel = resolvePricingModel(model);
  const pricing = MODEL_PRICING[pricingModel] ?? DEFAULT_PRICING;
  const inputCost = (Math.max(inputTokens, 0) / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost =
    (Math.max(outputTokens, 0) / 1_000_000) * pricing.outputPerMillionUsd;

  return {
    costUsd: inputCost + outputCost,
    pricingModel,
    pricing,
  };
}

export function normalizeGenerationUsage(
  usage: RawResponseUsage | null | undefined,
): GenerationTokenUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;
  const cachedInputTokens = usage.input_tokens_details?.cached_tokens;
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(typeof cachedInputTokens === "number"
      ? { cachedInputTokens }
      : {}),
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
  };
}

export function sumGenerationUsage(
  ...usages: Array<GenerationTokenUsage | null | undefined>
): GenerationTokenUsage {
  return usages.reduce<GenerationTokenUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + (usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (usage?.outputTokens ?? 0),
      totalTokens: total.totalTokens + (usage?.totalTokens ?? 0),
      cachedInputTokens:
        (total.cachedInputTokens ?? 0) + (usage?.cachedInputTokens ?? 0),
      reasoningTokens:
        (total.reasoningTokens ?? 0) + (usage?.reasoningTokens ?? 0),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  );
}

function formatCostUsd(costUsd: number): string {
  if (costUsd === 0) {
    return "$0.00 USD";
  }
  if (costUsd >= 1) {
    return `$${costUsd.toFixed(2)} USD`;
  }
  if (costUsd >= 0.01) {
    return `$${costUsd.toFixed(3)} USD`;
  }
  return `$${costUsd.toFixed(4)} USD`;
}

export function createCostSummary(params: {
  kind: GenerationCostSummary["kind"];
  model: string;
  usage: GenerationTokenUsage;
  approximate: boolean;
  note?: string;
}): GenerationCostSummary {
  const { costUsd, pricingModel } = estimateTextTokenCostUsd(
    params.model,
    params.usage.inputTokens,
    params.usage.outputTokens,
  );

  return {
    kind: params.kind,
    approximate: params.approximate,
    amountUsd: costUsd,
    display: formatCostUsd(costUsd),
    pricingModel,
    usage: params.usage,
    ...(params.note ? { note: params.note } : {}),
  };
}

export function createEstimateCostSummary(params: {
  model: string;
  explanationInputTokens: number;
  graphStaticInputTokens: number;
  approximate: boolean;
  note?: string;
  graphAttemptCount?: number;
}): GenerationCostSummary {
  const graphAttemptCount = params.graphAttemptCount ?? 1;
  const usage: GenerationTokenUsage = {
    inputTokens:
      params.explanationInputTokens +
      params.graphStaticInputTokens +
      EXPLANATION_MAX_OUTPUT_TOKENS,
    outputTokens:
      EXPLANATION_MAX_OUTPUT_TOKENS +
      GRAPH_MAX_OUTPUT_TOKENS * graphAttemptCount,
    totalTokens: 0,
  };
  usage.totalTokens = usage.inputTokens + usage.outputTokens;

  return createCostSummary({
    kind: "estimate",
    model: params.model,
    usage,
    approximate: params.approximate,
    note:
      params.note ??
      "Estimate assumes one graph-planning attempt and the configured output caps.",
  });
}
