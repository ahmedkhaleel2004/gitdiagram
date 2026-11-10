export type AIProvider = "openai" | "openrouter" | "meta";
export type GenerationServiceTier = "default" | "priority";

const DEFAULT_PROVIDER: AIProvider = "openai";
const DEFAULT_OPENAI_MODEL = "gpt-6-luna";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.6-terra";
const DEFAULT_META_MODEL = "muse-ember-1.0";
// Muse Ember draws a diagram in about half GPT-6 Luna's time with arrows a
// blind judge found as well supported (experiments/diagram-ember).
const MUSE_EMBER_MODEL_PATTERN = /^muse-ember(?:-\d+(?:\.\d+)?)?$/i;
const MANAGED_OPENAI_MODEL_PATTERN =
  /^gpt-(?:5\.6(?:-(?:sol|terra|luna))?|6-luna)(?:-\d{4}-\d{2}-\d{2})?$/i;

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function normalizeProvider(value?: string): AIProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "openrouter") {
    return "openrouter";
  }
  if (normalized === "meta") {
    return "meta";
  }
  return DEFAULT_PROVIDER;
}

export function getProvider(overrideProvider?: string): AIProvider {
  return normalizeProvider(overrideProvider ?? readEnvValue("AI_PROVIDER"));
}

/**
 * The provider one generation runs on. Meta only ever runs on GitDiagram's own
 * key: the key a visitor saves is an OpenAI key, so their generation goes to
 * OpenAI whatever the server uses for its own.
 */
export function getGenerationProvider(params: { apiKey?: string }): AIProvider {
  const provider = getProvider();
  return provider === "meta" && params.apiKey?.trim() ? "openai" : provider;
}

export function getProviderLabel(provider: AIProvider): string {
  if (provider === "meta") return "Meta";
  return provider === "openrouter" ? "OpenRouter" : "OpenAI";
}

function isMuseEmberModel(model: string): boolean {
  return MUSE_EMBER_MODEL_PATTERN.test(model.trim());
}

export function supportsExactInputTokenCount(provider: AIProvider): boolean {
  return provider === "openai";
}

export function supportsTextVerbosity(
  provider: AIProvider,
  model: string,
): boolean {
  return (
    provider === "openai" && MANAGED_OPENAI_MODEL_PATTERN.test(model.trim())
  );
}

/**
 * The standard lane, unless GENERATION_FAST_LANE=1: Fast mode costs double and
 * measured about 3 s quicker on a whole diagram (8.3 s against 11.5 s, see
 * experiments/diagram-haiku). It is funded by GitDiagram, never silently
 * charged to a user's key.
 */
export function getGenerationServiceTier(params: {
  provider: AIProvider;
  model: string;
  apiKey?: string;
}): GenerationServiceTier {
  return readEnvValue("GENERATION_FAST_LANE") === "1" &&
    params.provider === "openai" &&
    !params.apiKey?.trim() &&
    MANAGED_OPENAI_MODEL_PATTERN.test(params.model.trim())
    ? "priority"
    : "default";
}

export function usesSinglePassArchitecture(params: {
  provider: AIProvider;
  model: string;
  apiKey?: string;
}): boolean {
  if (params.apiKey?.trim()) return false;
  if (params.provider === "meta") return isMuseEmberModel(params.model);
  return (
    params.provider === "openai" &&
    /^gpt-(?:5\.6|6)-luna(?:-\d{4}-\d{2}-\d{2})?$/i.test(params.model.trim())
  );
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
  if (provider === "openrouter") {
    return readEnvValue("OPENROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL;
  }
  if (provider === "meta") {
    return readEnvValue("META_MODEL") ?? DEFAULT_META_MODEL;
  }

  return readEnvValue("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL;
}
