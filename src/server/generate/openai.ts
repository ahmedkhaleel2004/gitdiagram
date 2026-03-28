import OpenAI from "openai";

import {
  getProviderLabel,
  type AIProvider,
} from "~/server/generate/model-config";

export type ReasoningEffort = "low" | "medium" | "high";

function getEnvApiKey(provider: AIProvider): string | undefined {
  if (provider === "openrouter") {
    return process.env.OPENROUTER_API_KEY?.trim();
  }

  return process.env.OPENAI_API_KEY?.trim();
}

function getOpenRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const siteUrl = process.env.OPENROUTER_SITE_URL?.trim();
  const appName = process.env.OPENROUTER_APP_NAME?.trim() || "GitDiagram";

  if (siteUrl) {
    headers["HTTP-Referer"] = siteUrl;
  }

  if (appName) {
    headers["X-OpenRouter-Title"] = appName;
  }

  return headers;
}

function createClient(provider: AIProvider, apiKey: string): OpenAI {
  if (provider === "openrouter") {
    return new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: getOpenRouterHeaders(),
    });
  }

  return new OpenAI({ apiKey });
}

function resolveApiKey(provider: AIProvider, overrideApiKey?: string): string {
  const apiKey = overrideApiKey?.trim() || getEnvApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `Missing ${getProviderLabel(provider)} API key. Set ${
        provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"
      } or provide api_key in request.`,
    );
  }
  return apiKey;
}

export function estimateTokens(text: string): number {
  // Rough heuristic used for fast gating/cost estimates in serverless.
  return Math.ceil(text.length / 4);
}

interface StreamCompletionParams {
  provider: AIProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
}

export async function* streamCompletion({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
  maxOutputTokens,
}: StreamCompletionParams): AsyncGenerator<string, void, void> {
  const client = createClient(provider, resolveApiKey(provider, apiKey));

  const stream = await client.responses.create({
    model,
    stream: true,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
  });

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      if (event.delta) {
        yield event.delta;
      }
      continue;
    }

    if (event.type === "error") {
      const message = event.message ?? "OpenAI stream failed.";
      throw new Error(message);
    }
  }
}

interface CountInputTokensParams {
  provider: AIProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
}

export async function countInputTokens({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
}: CountInputTokensParams): Promise<number> {
  const client = createClient(provider, resolveApiKey(provider, apiKey));

  const response = await client.responses.inputTokens.count({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
  });

  return response.input_tokens;
}
