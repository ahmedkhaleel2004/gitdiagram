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
export type TextVerbosity = "low" | "medium" | "high";

const DEFAULT_ATLAS_BASE_URL = "https://api.atlascloud.ai/v1";

function getEnvApiKey(provider: AIProvider): string | undefined {
  if (provider === "atlas") {
    return process.env.ATLAS_API_KEY?.trim();
  }
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
  if (provider === "atlas") {
    return new OpenAI({
      apiKey,
      baseURL: process.env.ATLAS_BASE_URL?.trim() || DEFAULT_ATLAS_BASE_URL,
      maxRetries: 0,
    });
  }
  if (provider === "openrouter") {
    return new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: getOpenRouterHeaders(),
      maxRetries: 0,
    });
  }

  return new OpenAI({
    apiKey,
    maxRetries: 0,
  });
}

function resolveApiKey(provider: AIProvider, overrideApiKey?: string): string {
  const apiKey = overrideApiKey?.trim() || getEnvApiKey(provider);
  if (!apiKey) {
    const envVarName =
      provider === "atlas"
        ? "ATLAS_API_KEY"
        : provider === "openrouter"
          ? "OPENROUTER_API_KEY"
          : "OPENAI_API_KEY";
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

function extractChatCompletionText(
  content:
    | string
    | Array<{ type?: string; text?: string | null }>
    | null
    | undefined,
): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function normalizeChatCompletionUsage(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | null | undefined): GenerationTokenUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function buildAtlasStructuredOutputPrompt(params: {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
}): string {
  if (params.schemaName === "diagram_graph") {
    return [
      params.userPrompt,
      "",
      "Return valid JSON only.",
      'Schema name: "diagram_graph".',
      "Use this exact shape:",
      '{',
      '  "groups": [{"id": "group_id", "label": "Group", "description": null}],',
      '  "nodes": [{"id": "node_id", "label": "Node", "type": "Subsystem", "description": null, "groupId": null, "path": null, "shape": null}],',
      '  "edges": [{"from": "source_id", "to": "target_id", "label": null, "description": null, "style": null}]',
      "}",
      "Required constraints:",
      '- Always include "groups", "nodes", and "edges".',
      '- Always include every object field. Use null instead of omitting optional fields.',
      '- "shape" must be one of: box, database, queue, document, circle, hexagon, or null.',
      '- "style" must be one of: solid, dashed, or null.',
      '- IDs must match ^[a-z][a-z0-9_]*$.',
      "- Return JSON only with no markdown fences or commentary.",
    ].join("\n");
  }

  return `${params.userPrompt}\n\nReturn valid JSON only for schema "${params.schemaName}" with no markdown fences or commentary.`;
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
  responseId: string | undefined,
  signal?: AbortSignal,
): Promise<GenerationTokenUsage | null> {
  if (!responseId) {
    return null;
  }

  const response = await client.responses.retrieve(
    responseId,
    undefined,
    signal ? { signal } : undefined,
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
}: StreamCompletionParams): Promise<StreamCompletionResult> {
  const client = createClient(provider, resolveApiKey(provider, apiKey));
  if (provider === "atlas") {
    const stream = await client.chat.completions.create(
      {
        model,
        stream: true,
        messages: buildMessages(systemPrompt, userPrompt),
        ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
      },
      signal ? { signal } : undefined,
    );

    let usageSettled = false;
    let resolveUsage!: (usage: GenerationTokenUsage | null) => void;
    const usagePromise = new Promise<GenerationTokenUsage | null>((resolve) => {
      resolveUsage = resolve;
    });

    async function* atlasOutputStream(): AsyncGenerator<string, void, void> {
      let finalUsage: GenerationTokenUsage | null = null;
      try {
        for await (const chunk of stream) {
          finalUsage =
            normalizeChatCompletionUsage(chunk.usage) ?? finalUsage;
          const delta = chunk.choices[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            yield delta;
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
      stream: atlasOutputStream(),
      usagePromise,
    };
  }

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
    signal ? { signal } : undefined,
  );

  let usageSettled = false;
  let resolveUsage!: (usage: GenerationTokenUsage | null) => void;
  const usagePromise = new Promise<GenerationTokenUsage | null>(
    (resolve) => {
      resolveUsage = resolve;
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

      if (!finalUsage) {
        try {
          finalUsage = await retrieveUsageFromResponseId(client, responseId, signal);
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
}

export async function countInputTokens({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
}: CountInputTokensParams): Promise<number> {
  if (provider === "atlas") {
    throw new Error("Atlas Cloud does not expose exact input token counting in this integration.");
  }

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
  textVerbosity,
  maxOutputTokens,
  signal,
}: StructuredCompletionParams<T>): Promise<{
  output: T;
  rawText: string;
  usage: GenerationTokenUsage | null;
}> {
  const client = createClient(provider, resolveApiKey(provider, apiKey));

  if (provider === "atlas") {
    const response = await client.chat.completions.create(
      {
        model,
        messages: buildMessages(
          systemPrompt,
          buildAtlasStructuredOutputPrompt({
            systemPrompt,
            userPrompt,
            schemaName,
          }),
        ),
        response_format: { type: "json_object" },
        temperature: 0,
        ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
      },
      signal ? { signal } : undefined,
    );

    const rawText = extractChatCompletionText(
      response.choices[0]?.message?.content,
    ).trim();
    if (!rawText) {
      throw new Error("Structured output parsing returned no parsed payload.");
    }

    return {
      output: schema.parse(JSON.parse(rawText)),
      rawText,
      usage: normalizeChatCompletionUsage(response.usage),
    };
  }

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
      signal ? { signal } : undefined,
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
      error instanceof Error ? error.message : "Structured output request failed.";
    if (provider === "openrouter") {
      throw new Error(
        `OpenRouter model does not support the required structured graph output: ${message}`,
      );
    }
    throw error;
  }
}
