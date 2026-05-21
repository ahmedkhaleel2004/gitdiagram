export type AIProvider = "openai" | "openrouter" | "cli";

const DEFAULT_PROVIDER: AIProvider = "openai";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.4";

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function normalizeProvider(value?: string): AIProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "openrouter" || normalized === "cli") {
    return normalized;
  }

  return DEFAULT_PROVIDER;
}

export function getProvider(overrideProvider?: string): AIProvider {
  return normalizeProvider(overrideProvider ?? readEnvValue("AI_PROVIDER"));
}

export function getProviderLabel(provider: AIProvider): string {
  if (provider === "cli") return "CLI";
  return provider === "openrouter" ? "OpenRouter" : "OpenAI";
}

export function supportsExactInputTokenCount(provider: AIProvider): boolean {
  return provider === "openai";
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
  if (provider === "cli") {
    return readEnvValue("AI_CLI_MODEL_LABEL") ?? "cli";
  }

  if (provider === "openrouter") {
    return readEnvValue("OPENROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL;
  }

  return readEnvValue("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL;
}
