import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import {
  getProviderLabel,
  supportsTextVerbosity,
  type AIProvider,
} from "~/server/generate/model-config";
import { normalizeGenerationUsage } from "~/server/generate/pricing";

export type ReasoningEffort = "low" | "medium" | "high";
type TextVerbosity = "low" | "medium" | "high";

const AI_REQUEST_TIMEOUT_MS = 150_000;
const AI_MAX_RETRIES = 0;

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
      maxRetries: AI_MAX_RETRIES,
      timeout: AI_REQUEST_TIMEOUT_MS,
    });
  }

  return new OpenAI({
    apiKey,
    maxRetries: AI_MAX_RETRIES,
    timeout: AI_REQUEST_TIMEOUT_MS,
  });
}

function buildRequestOptions(params: {
  provider: AIProvider;
  signal?: AbortSignal;
  clientRequestId?: string;
}) {
  const headers =
    params.provider === "openai" && params.clientRequestId
      ? { "X-Client-Request-Id": params.clientRequestId }
      : undefined;

  if (!params.signal && !headers) {
    return undefined;
  }

  return {
    ...(params.signal ? { signal: params.signal } : {}),
    ...(headers ? { headers } : {}),
  };
}

function resolveApiKey(provider: AIProvider, overrideApiKey?: string): string {
  const apiKey = overrideApiKey?.trim() || getEnvApiKey(provider);
  if (!apiKey) {
    const envVarName =
      provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
    throw new Error(
      `Missing ${getProviderLabel(provider)} API key. Set ${envVarName} or provide api_key in request.`,
    );
  }
  return apiKey;
}

function buildMessages(systemPrompt: string, userPrompt: string) {
  return [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];
}

export function estimateTokens(text: string): number {
  // Conservative local estimate used when we deliberately avoid billable count calls.
  return text.length === 0 ? 0 : Math.ceil(text.length / 3) + 32;
}

interface StreamCompletionParams {
  provider: AIProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
  textVerbosity?: TextVerbosity;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  clientRequestId?: string;
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
  textVerbosity?: TextVerbosity;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  clientRequestId?: string;
}

interface StreamCompletionResult {
  stream: AsyncGenerator<string, void, void>;
  usagePromise: Promise<GenerationTokenUsage | null>;
}

function getResponseFailureMessage(response: {
  error?: { message?: string | null } | null;
  incomplete_details?: { reason?: string | null } | null;
}): string {
  if (response.error?.message) {
    return response.error.message;
  }

  if (response.incomplete_details?.reason) {
    return `OpenAI response incomplete: ${response.incomplete_details.reason}.`;
  }

  return "OpenAI response did not complete successfully.";
}

async function retrieveUsageFromResponseId(
  client: OpenAI,
  provider: AIProvider,
  responseId: string | undefined,
  signal?: AbortSignal,
  clientRequestId?: string,
): Promise<GenerationTokenUsage | null> {
  if (!responseId) {
    return null;
  }

  const response = await client.responses.retrieve(
    responseId,
    undefined,
    buildRequestOptions({ provider, signal, clientRequestId }),
  );
  return normalizeGenerationUsage(response.usage);
}

export async function streamCompletion({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
  textVerbosity,
  maxOutputTokens,
  signal,
  clientRequestId,
}: StreamCompletionParams): Promise<StreamCompletionResult> {
  const client = createClient(provider, resolveApiKey(provider, apiKey));
  const stream = await client.responses.create(
    {
      model,
      stream: true,
      input: buildMessages(systemPrompt, userPrompt),
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      ...(textVerbosity && supportsTextVerbosity(provider, model)
        ? { text: { verbosity: textVerbosity } }
        : {}),
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    },
    buildRequestOptions({ provider, signal, clientRequestId }),
  );

  let usageSettled = false;
  let resolveUsage!: (usage: GenerationTokenUsage | null) => void;
  const usagePromise = new Promise<GenerationTokenUsage | null>((resolve) => {
    resolveUsage = resolve;
  });

  async function* outputStream(): AsyncGenerator<string, void, void> {
    let responseId: string | undefined;
    let finalUsage: GenerationTokenUsage | null = null;
    let completed = false;

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
          completed = true;
          finalUsage = normalizeGenerationUsage(event.response.usage);
          continue;
        }

        if (event.type === "response.failed") {
          throw new Error(getResponseFailureMessage(event.response));
        }

        if (event.type === "response.incomplete") {
          throw new Error(getResponseFailureMessage(event.response));
        }

        if (event.type === "error") {
          const message = event.message ?? "OpenAI stream failed.";
          throw new Error(message);
        }
      }

      if (!completed) {
        throw new Error("OpenAI stream ended before response.completed.");
      }

      if (!finalUsage) {
        try {
          finalUsage = await retrieveUsageFromResponseId(
            client,
            provider,
            responseId,
            signal,
            clientRequestId ? `${clientRequestId}:usage` : undefined,
          );
        } catch {
          finalUsage = null;
        }
      }

      usageSettled = true;
      resolveUsage(finalUsage);
    } catch (error) {
      usageSettled = true;
      resolveUsage(null);
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
  signal?: AbortSignal;
  clientRequestId?: string;
}

export async function countInputTokens({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
  signal,
  clientRequestId,
}: CountInputTokensParams): Promise<number> {
  const client = createClient(provider, resolveApiKey(provider, apiKey));

  const response = await client.responses.inputTokens.count(
    {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    },
    buildRequestOptions({ provider, signal, clientRequestId }),
  );

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
  textVerbosity,
  maxOutputTokens,
  signal,
  clientRequestId,
}: StructuredCompletionParams<T>): Promise<{
  output: T;
  rawText: string;
  usage: GenerationTokenUsage | null;
}> {
  const client = createClient(provider, resolveApiKey(provider, apiKey));

  try {
    const response = await client.responses.parse(
      {
        model,
        input: buildMessages(systemPrompt, userPrompt),
        text: {
          format: zodTextFormat(schema, schemaName),
          ...(textVerbosity && supportsTextVerbosity(provider, model)
            ? { verbosity: textVerbosity }
            : {}),
        },
        ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
        ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
      },
      buildRequestOptions({ provider, signal, clientRequestId }),
    );

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
      error instanceof Error
        ? error.message
        : "Structured output request failed.";
    if (provider === "openrouter") {
      throw new Error(
        `OpenRouter model does not support the required structured graph output: ${message}`,
      );
    }
    throw error;
  }
}
