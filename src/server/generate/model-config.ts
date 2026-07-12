export type AIProvider = "atlas" | "openai" | "openrouter";

import { DEFAULT_ATLAS_MODEL } from "~/server/generate/atlas-models";

const DEFAULT_PROVIDER: AIProvider = "openai";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.6-terra";
const GPT_56_MODEL_PATTERN =
  /^gpt-5\.6(?:-(?:sol|terra|luna))?(?:-\d{4}-\d{2}-\d{2})?$/i;

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function normalizeProvider(value?: string): AIProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "atlas") {
    return "atlas";
  }
  if (normalized === "openrouter") {
    return "openrouter";
  }
  return DEFAULT_PROVIDER;
}

export function getProvider(overrideProvider?: string): AIProvider {
  return normalizeProvider(overrideProvider ?? readEnvValue("AI_PROVIDER"));
}

export function getProviderLabel(provider: AIProvider): string {
  if (provider === "atlas") {
    return "Atlas Cloud";
  }
  return provider === "openrouter" ? "OpenRouter" : "OpenAI";
}

export function supportsExactInputTokenCount(provider: AIProvider): boolean {
  return provider === "openai";
}

export function supportsTextVerbosity(
  provider: AIProvider,
  model: string,
): boolean {
  return provider === "openai" && GPT_56_MODEL_PATTERN.test(model.trim());
}

export function shouldUseExactInputTokenCount(params: {
  provider: AIProvider;
  apiKey?: string;
}): boolean {
  return (
    supportsExactInputTokenCount(params.provider) &&
    Boolean(params.apiKey?.trim())
  );
}

export function getModel(provider = getProvider()): string {
  if (provider === "atlas") {
    return readEnvValue("ATLAS_MODEL") ?? DEFAULT_ATLAS_MODEL;
  }
  if (provider === "openrouter") {
    return readEnvValue("OPENROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL;
  }

  return readEnvValue("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL;
}
