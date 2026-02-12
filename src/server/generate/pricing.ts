export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const DEFAULT_PRICING_MODEL = "gpt-5.2";

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.2": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2-chat-latest": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2-codex": { inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2-pro": { inputPerMillionUsd: 21.0, outputPerMillionUsd: 168.0 },

  // Legacy fallbacks kept for older env values.
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

export function resolvePricingModel(model: string): string {
  const normalized = normalizeModelId(model);
  if (MODEL_PRICING[normalized]) return normalized;

  const withoutDate = stripDateSnapshotSuffix(normalized);
  if (MODEL_PRICING[withoutDate]) return withoutDate;

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
