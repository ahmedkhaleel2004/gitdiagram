import type {
  GenerationCostSummary,
  GenerationTokenUsage,
} from "~/features/diagram/cost";
import {
  EXPLANATION_ESTIMATED_OUTPUT_TOKENS,
  GRAPH_ESTIMATED_OUTPUT_TOKENS,
} from "~/server/generate/generation-policy";

export {
  EXPLANATION_ESTIMATED_OUTPUT_TOKENS,
  GRAPH_ESTIMATED_OUTPUT_TOKENS,
  GRAPH_RETRY_INPUT_BUFFER_TOKENS,
} from "~/server/generate/generation-policy";

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
    cache_write_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.6-sol": { inputPerMillionUsd: 4.0, outputPerMillionUsd: 20.0 },
  "gpt-5.6-terra": { inputPerMillionUsd: 2.0, outputPerMillionUsd: 12.0 },
  "gpt-5.6-luna": { inputPerMillionUsd: 0.2, outputPerMillionUsd: 1.2 },
  "gpt-5.4": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 15.0 },
  "gpt-5.4-pro": { inputPerMillionUsd: 30.0, outputPerMillionUsd: 180.0 },
  "gpt-5.4-nano": { inputPerMillionUsd: 0.2, outputPerMillionUsd: 1.25 },

  // Retain pricing entries for older model ids that may still appear in stored data or requests.
  "gpt-5.2": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2-chat-latest": {
    inputPerMillionUsd: 1.75,
    outputPerMillionUsd: 14.0,
  },
  "gpt-5.2-codex": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2-pro": { inputPerMillionUsd: 21.0, outputPerMillionUsd: 168.0 },

  "gpt-5.1": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
  "gpt-5": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
  "gpt-5-mini": { inputPerMillionUsd: 0.25, outputPerMillionUsd: 2.0 },
  "gpt-5-nano": { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 },
  "o4-mini": { inputPerMillionUsd: 1.1, outputPerMillionUsd: 4.4 },
};
export const MODEL_PRICING_UNAVAILABLE_ERROR =
  "Cost information is unavailable for the configured AI model.";

export class ModelPricingUnavailableError extends Error {
  constructor() {
    super(MODEL_PRICING_UNAVAILABLE_ERROR);
    this.name = "ModelPricingUnavailableError";
  }
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function stripDateSnapshotSuffix(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/i, "");
}

function stripProviderPrefix(model: string): string {
  return model.includes("/") ? (model.split("/").at(-1) ?? model) : model;
}

export function resolvePricingModel(model: string): string | null {
  const normalized = normalizeModelId(model);
  if (MODEL_PRICING[normalized]) return normalized;

  const withoutDate = stripDateSnapshotSuffix(stripProviderPrefix(normalized));
  if (MODEL_PRICING[withoutDate]) return withoutDate;

  if (withoutDate === "gpt-5.6") return "gpt-5.6-sol";
  if (withoutDate.startsWith("gpt-5.6-sol")) return "gpt-5.6-sol";
  if (withoutDate.startsWith("gpt-5.6-terra")) return "gpt-5.6-terra";
  if (withoutDate.startsWith("gpt-5.6-luna")) return "gpt-5.6-luna";
  if (withoutDate.startsWith("gpt-5.4-pro")) return "gpt-5.4-pro";
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

  return null;
}

export function assertModelPricingAvailable(model: string): string {
  const pricingModel = resolvePricingModel(model);
  if (!pricingModel) {
    throw new ModelPricingUnavailableError();
  }
  return pricingModel;
}

export function estimateTextTokenCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  serviceTier?: string,
): { costUsd: number; pricingModel: string; pricing: ModelPricing } {
  const pricingModel = assertModelPricingAvailable(model);
  const basePricing = MODEL_PRICING[pricingModel];
  if (!basePricing) {
    throw new ModelPricingUnavailableError();
  }
  const multiplier =
    /^gpt-5\.6-(?:luna|terra|sol)$/.test(pricingModel) &&
    (serviceTier === "priority" || serviceTier === "fast")
      ? 2
      : 1;
  const pricing = {
    inputPerMillionUsd: basePricing.inputPerMillionUsd * multiplier,
    outputPerMillionUsd: basePricing.outputPerMillionUsd * multiplier,
  };
  const inputCost =
    (Math.max(inputTokens, 0) / 1_000_000) * pricing.inputPerMillionUsd;
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
  serviceTier?: string | null,
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
    ...(serviceTier ? { serviceTier } : {}),
    ...(typeof usage.input_tokens_details?.cache_write_tokens === "number"
      ? { cacheWriteTokens: usage.input_tokens_details.cache_write_tokens }
      : {}),
    ...(typeof cachedInputTokens === "number" ? { cachedInputTokens } : {}),
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
      cacheWriteTokens:
        (total.cacheWriteTokens ?? 0) + (usage?.cacheWriteTokens ?? 0),
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
  const {
    costUsd: baseCostUsd,
    pricingModel,
    pricing,
  } = estimateTextTokenCostUsd(
    params.model,
    params.usage.inputTokens,
    params.usage.outputTokens,
  );

  const is56 = /^gpt-5\.6-(?:luna|terra|sol)$/.test(pricingModel);
  const reads = Math.min(
    Math.max(params.usage.cachedInputTokens ?? 0, 0),
    params.usage.inputTokens,
  );
  const writes = Math.min(
    Math.max(params.usage.cacheWriteTokens ?? 0, 0),
    Math.max(0, params.usage.inputTokens - reads),
  );
  const cacheAdjustment = is56
    ? ((-0.9 * reads + 0.25 * writes) * pricing.inputPerMillionUsd) / 1_000_000
    : 0;
  const tier = params.usage.serviceTier;
  const tierMultiplier =
    is56 && (tier === "fast" || tier === "priority") ? 2 : 1;
  const unknownTier = Boolean(
    tier && !["default", "fast", "priority"].includes(tier),
  );
  const costUsd = (baseCostUsd + cacheAdjustment) * tierMultiplier;
  return {
    kind: params.kind,
    approximate: params.approximate || unknownTier,
    amountUsd: costUsd,
    display: formatCostUsd(costUsd),
    pricingModel,
    usage: params.usage,
    ...(params.note ? { note: params.note } : {}),
  };
}

export function createEstimateCostSummary(params: {
  model: string;
  analysisModel?: string;
  explanationInputTokens: number;
  graphStaticInputTokens: number;
  approximate: boolean;
  note?: string;
  graphAttemptCount?: number;
  analysisServiceTier?: string;
  graphServiceTier?: string;
  singlePass?: boolean;
}): GenerationCostSummary {
  const stage = (
    model: string,
    inputTokens: number,
    outputTokens: number,
    serviceTier?: string,
  ) =>
    createCostSummary({
      kind: "estimate",
      model,
      approximate: params.approximate,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cacheWriteTokens: inputTokens,
        ...(serviceTier ? { serviceTier } : {}),
      },
    });
  return combineCostSummaries(
    [
      stage(
        params.analysisModel ?? params.model,
        params.explanationInputTokens,
        EXPLANATION_ESTIMATED_OUTPUT_TOKENS,
        params.analysisServiceTier,
      ),
      ...(params.singlePass
        ? []
        : [
            stage(
              params.model,
              params.graphStaticInputTokens +
                EXPLANATION_ESTIMATED_OUTPUT_TOKENS,
              GRAPH_ESTIMATED_OUTPUT_TOKENS * (params.graphAttemptCount ?? 1),
              params.graphServiceTier,
            ),
          ]),
    ],
    params.note ??
      "Estimate assumes one graph-planning attempt, uncached writes and the estimated output usage; actual usage may be higher.",
  );
}

/** Sum already-priced stages: applying one model's rate to mixed tokens is wrong. */
export function combineCostSummaries(
  summaries: GenerationCostSummary[],
  note?: string,
): GenerationCostSummary {
  const amountUsd = summaries.reduce((sum, entry) => sum + entry.amountUsd, 0);
  return {
    kind: summaries.every((entry) => entry.kind === "actual")
      ? "actual"
      : "estimate",
    approximate: summaries.some((entry) => entry.approximate),
    amountUsd,
    display: formatCostUsd(amountUsd),
    pricingModel: [
      ...new Set(summaries.map((entry) => entry.pricingModel)),
    ].join(" + "),
    usage: sumGenerationUsage(...summaries.map((entry) => entry.usage)),
    ...(note ? { note } : {}),
  };
}
