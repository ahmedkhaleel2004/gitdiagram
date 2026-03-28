import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import {
  getProviderLabel,
  type AIProvider,
} from "~/server/generate/model-config";
import { normalizeGenerationUsage } from "~/server/generate/pricing";

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

interface StructuredCompletionParams<T> {
  provider: AIProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema: ZodType<T>;
  schemaName: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
}

interface StreamCompletionResult {
  stream: AsyncGenerator<string, void, void>;
  usagePromise: Promise<GenerationTokenUsage | null>;
}

async function retrieveUsageFromResponseId(
  client: OpenAI,
  responseId: string | undefined,
): Promise<GenerationTokenUsage | null> {
  if (!responseId) {
    return null;
  }

  const response = await client.responses.retrieve(responseId);
  return normalizeGenerationUsage(response.usage);
}

export async function streamCompletion({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
  maxOutputTokens,
}: StreamCompletionParams): Promise<StreamCompletionResult> {
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

  let usageSettled = false;
  let resolveUsage!: (usage: GenerationTokenUsage | null) => void;
  let rejectUsage!: (error: unknown) => void;
  const usagePromise = new Promise<GenerationTokenUsage | null>(
    (resolve, reject) => {
      resolveUsage = resolve;
      rejectUsage = reject;
    },
  );

  async function* outputStream(): AsyncGenerator<string, void, void> {
    let responseId: string | undefined;
    let finalUsage: GenerationTokenUsage | null = null;

    try {
      for await (const event of stream) {
        const response = "response" in event ? event.response : undefined;
        if (response?.id) {
          responseId = response.id;
        }

        if (event.type === "response.output_text.delta") {
          if (event.delta) {
            yield event.delta;
          }
          continue;
        }

        if (event.type === "response.completed") {
          finalUsage = normalizeGenerationUsage(event.response.usage);
          continue;
        }

        if (event.type === "error") {
          const message = event.message ?? "OpenAI stream failed.";
          throw new Error(message);
        }
      }

      if (!finalUsage) {
        finalUsage = await retrieveUsageFromResponseId(client, responseId);
      }

      usageSettled = true;
      resolveUsage(finalUsage);
    } catch (error) {
      usageSettled = true;
      rejectUsage(error);
      throw error;
    } finally {
      if (!usageSettled) {
        resolveUsage(null);
      }
    }
  }

  return {
    stream: outputStream(),
    usagePromise,
  };
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

export async function generateStructuredOutput<T>({
  provider,
  model,
  systemPrompt,
  userPrompt,
  schema,
  schemaName,
  apiKey,
  reasoningEffort,
  maxOutputTokens,
}: StructuredCompletionParams<T>): Promise<{
  output: T;
  rawText: string;
  usage: GenerationTokenUsage | null;
}> {
  const client = createClient(provider, resolveApiKey(provider, apiKey));

  try {
    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: zodTextFormat(schema, schemaName),
      },
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    });

    if (!response.output_parsed) {
      throw new Error("Structured output parsing returned no parsed payload.");
    }

    const rawText =
      response.output_text?.trim() ||
      JSON.stringify(response.output_parsed, null, 2);

    return {
      output: response.output_parsed,
      rawText,
      usage: normalizeGenerationUsage(response.usage),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Structured output request failed.";
    if (provider === "openrouter") {
      throw new Error(
        `OpenRouter model does not support the required structured graph output: ${message}`,
      );
    }
    throw error;
  }
}
