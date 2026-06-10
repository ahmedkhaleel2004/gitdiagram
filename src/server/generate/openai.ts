import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import { diagramNodeShapeSchema } from "~/features/diagram/graph";
import { runCliCompletion } from "~/server/generate/cli";
import {
  getProviderLabel,
  type AIProvider,
} from "~/server/generate/model-config";
import { normalizeGenerationUsage } from "~/server/generate/pricing";

export type ReasoningEffort = "low" | "medium" | "high";

function getEnvApiKey(provider: AIProvider): string | undefined {
  if (provider === "cli") {
    return undefined;
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
  if (provider === "cli") {
    throw new Error("CLI provider does not use the OpenAI client.");
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
  if (provider === "cli") {
    return "";
  }

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
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

interface StreamCompletionResult {
  stream: AsyncGenerator<string, void, void>;
  usagePromise: Promise<GenerationTokenUsage | null>;
}

function extractJsonObject(text: string): string {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return unfenced;
  }

  return unfenced.slice(firstBrace, lastBrace + 1);
}

function escapeLiteralNewlinesInJsonStrings(text: string): string {
  let result = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString && char === "\r") {
      if (text[index + 1] === "\n") {
        index += 1;
      }
      result += "\\n";
      continue;
    }

    if (inString && char === "\n") {
      result += "\\n";
      continue;
    }

    result += char;
  }

  return result;
}

function findNextSignificantChar(text: string, startIndex: number): string | null {
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (!char) continue;
    if (!/\s/.test(char)) {
      return char;
    }
  }

  return null;
}

function escapeLooseQuotesInJsonStrings(text: string): string {
  let result = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        inString = true;
        result += char;
        continue;
      }

      const nextSignificantChar = findNextSignificantChar(text, index + 1);
      if (
        nextSignificantChar === null ||
        nextSignificantChar === "," ||
        nextSignificantChar === ":" ||
        nextSignificantChar === "}" ||
        nextSignificantChar === "]"
      ) {
        inString = false;
        result += char;
        continue;
      }

      result += '\\"';
      continue;
    }

    if (inString && char === "\t") {
      result += "\\t";
      continue;
    }

    if (inString && (char === "}" || char === "]")) {
      const nextSignificantChar = findNextSignificantChar(text, index + 1);
      if (
        nextSignificantChar === null ||
        nextSignificantChar === "," ||
        nextSignificantChar === "}" ||
        nextSignificantChar === "]"
      ) {
        result += `"${char}`;
        inString = false;
        continue;
      }
    }

    if (inString) {
      const codePoint = char.codePointAt(0);
      if (codePoint !== undefined && codePoint < 0x20) {
        result += `\\u${codePoint.toString(16).padStart(4, "0")}`;
        continue;
      }
    }

    result += char;
  }

  if (inString) {
    result += '"';
  }

  return result;
}

function balanceJsonBrackets(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      stack.push("}");
      continue;
    }

    if (char === "[") {
      stack.push("]");
      continue;
    }

    if ((char === "}" || char === "]") && stack.at(-1) === char) {
      stack.pop();
    }
  }

  if (stack.length === 0) {
    return text;
  }

  return `${text}${stack.reverse().join("")}`;
}

function stripTrailingCommas(text: string): string {
  let current = text;
  let next = current.replace(/,\s*([}\]])/g, "$1");
  while (next !== current) {
    current = next;
    next = current.replace(/,\s*([}\]])/g, "$1");
  }
  return current;
}

export function parseCliJsonObject(text: string): {
  rawText: string;
  parsed: unknown;
} {
  const rawText = extractJsonObject(text);

  try {
    return {
      rawText,
      parsed: JSON.parse(rawText) as unknown,
    };
  } catch (originalError) {
    const repaired = balanceJsonBrackets(
      stripTrailingCommas(
        escapeLooseQuotesInJsonStrings(
          escapeLiteralNewlinesInJsonStrings(rawText),
        ),
      ),
    );

    if (repaired !== rawText) {
      try {
        return {
          rawText: repaired,
          parsed: JSON.parse(repaired) as unknown,
        };
      } catch {
        // Fall through to surface the original parse error below.
      }
    }

    throw originalError;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fillMissingNullableField(
  value: Record<string, unknown>,
  field: string,
) {
  if (!(field in value)) {
    value[field] = null;
  }
}

function readStringAlias(value: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const aliasValue = value[alias];
    if (typeof aliasValue === "string" && aliasValue.trim()) {
      return aliasValue;
    }
  }

  return undefined;
}

function readArrayAlias(value: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const aliasValue = value[alias];
    if (Array.isArray(aliasValue)) {
      return aliasValue;
    }
  }

  return undefined;
}

const cliDiagramKeyAliases = new Map<string, string>([
  ["groups", "groups"],
  ["nodes", "nodes"],
  ["edges", "edges"],
  ["relationships", "edges"],
  ["relations", "edges"],
  ["links", "edges"],
  ["connections", "edges"],
  ["id", "id"],
  ["label", "label"],
  ["name", "name"],
  ["title", "title"],
  ["description", "description"],
  ["parent", "parent"],
  ["group", "group"],
  ["groupid", "groupId"],
  ["type", "type"],
  ["kind", "kind"],
  ["category", "category"],
  ["role", "role"],
  ["path", "path"],
  ["shape", "shape"],
  ["from", "from"],
  ["to", "to"],
  ["source", "source"],
  ["sourceid", "sourceId"],
  ["source_id", "source_id"],
  ["target", "target"],
  ["targetid", "targetId"],
  ["target_id", "target_id"],
  ["style", "style"],
]);

function normalizeCliObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCliObjectKeys(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const compactKey = rawKey.replace(/\s+/g, "").toLowerCase();
    const nextKey = cliDiagramKeyAliases.get(compactKey) ?? rawKey;
    if (!(nextKey in normalized)) {
      normalized[nextKey] = normalizeCliObjectKeys(rawValue);
    }
  }

  return normalized;
}

function fillMissingStringField(params: {
  value: Record<string, unknown>;
  field: string;
  aliases?: string[];
  fallback: string;
}) {
  const current = params.value[params.field];
  if (typeof current === "string" && current.trim()) {
    params.value[params.field] = current.trim();
    return;
  }

  const aliasValue = params.aliases
    ? readStringAlias(params.value, params.aliases)
    : undefined;
  params.value[params.field] = aliasValue?.trim() || params.fallback;
}

function slugId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : fallback;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const withLeadingLetter = /^[a-z]/.test(normalized)
    ? normalized
    : `id_${normalized}`;

  return /^[a-z][a-z0-9_]*$/.test(withLeadingLetter)
    ? withLeadingLetter
    : fallback;
}

function uniqueId(
  value: unknown,
  fallbackPrefix: string,
  index: number,
  usedIds: Set<string>,
): string {
  const base = slugId(value, `${fallbackPrefix}_${index + 1}`);
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

export function normalizeCliStructuredOutput(
  schemaName: string,
  value: unknown,
): unknown {
  if (schemaName !== "diagram_graph") {
    return value;
  }

  const normalizedValue = normalizeCliObjectKeys(value);
  if (!isRecord(normalizedValue)) {
    return normalizedValue;
  }

  if (!Array.isArray(normalizedValue.groups)) {
    normalizedValue.groups =
      readArrayAlias(normalizedValue, ["groups", "sections", "clusters"]) ?? [];
  }

  if (!Array.isArray(normalizedValue.nodes)) {
    normalizedValue.nodes =
      readArrayAlias(normalizedValue, ["nodes", "components", "items"]) ?? [];
  }

  if (!Array.isArray(normalizedValue.edges)) {
    normalizedValue.edges =
      readArrayAlias(normalizedValue, [
        "edges",
        "relationships",
        "relations",
        "links",
        "connections",
      ]) ?? [];
  }

  const groupIds = new Map<string, string>();
  if (Array.isArray(normalizedValue.groups)) {
    const usedGroupIds = new Set<string>();
    normalizedValue.groups.forEach((group, index) => {
      if (!isRecord(group)) return;
      const originalId = typeof group.id === "string" ? group.id : undefined;
      const normalizedId = uniqueId(group.id, "group", index, usedGroupIds);
      group.id = normalizedId;
      if (originalId) {
        groupIds.set(originalId, normalizedId);
      }
      fillMissingStringField({
        value: group,
        field: "label",
        aliases: ["name", "title"],
        fallback: originalId?.trim() || normalizedId,
      });
      fillMissingNullableField(group, "description");
    });
  }

  const nodeIds = new Map<string, string>();
  if (Array.isArray(normalizedValue.nodes)) {
    const usedNodeIds = new Set<string>();
    normalizedValue.nodes.forEach((node, index) => {
      if (!isRecord(node)) return;
      const originalId = typeof node.id === "string" ? node.id : undefined;
      const normalizedId = uniqueId(node.id, "node", index, usedNodeIds);
      node.id = normalizedId;
      if (originalId) {
        nodeIds.set(originalId, normalizedId);
      }
      fillMissingStringField({
        value: node,
        field: "label",
        aliases: ["name", "title"],
        fallback: originalId?.trim() || normalizedId,
      });
      fillMissingStringField({
        value: node,
        field: "type",
        aliases: ["kind", "category", "role", "label"],
        fallback: "component",
      });
      fillMissingNullableField(node, "description");
      const aliasedGroupId = readStringAlias(node, ["groupId", "group"]);
      if (aliasedGroupId) {
        node.groupId = aliasedGroupId;
      }
      fillMissingNullableField(node, "groupId");
      if (typeof node.groupId === "string") {
        node.groupId =
          groupIds.get(node.groupId) ?? slugId(node.groupId, node.groupId);
      }
      fillMissingNullableField(node, "path");
      fillMissingNullableField(node, "shape");
      if (!diagramNodeShapeSchema.safeParse(node.shape).success) {
        node.shape = null;
      }
    });
  }

  if (Array.isArray(normalizedValue.edges)) {
    for (const edge of normalizedValue.edges) {
      if (!isRecord(edge)) continue;
      edge.from =
        typeof edge.from === "string"
          ? edge.from
          : readStringAlias(edge, ["source", "sourceId", "source_id"]);
      edge.to =
        typeof edge.to === "string"
          ? edge.to
          : readStringAlias(edge, ["target", "targetId", "target_id"]);
      if (typeof edge.from === "string") {
        edge.from = nodeIds.get(edge.from) ?? slugId(edge.from, edge.from);
      }
      if (typeof edge.to === "string") {
        edge.to = nodeIds.get(edge.to) ?? slugId(edge.to, edge.to);
      }
      fillMissingNullableField(edge, "label");
      fillMissingNullableField(edge, "description");
      fillMissingNullableField(edge, "style");
      if (edge.style !== "solid" && edge.style !== "dashed") {
        edge.style = null;
      }
    }
  }

  return normalizedValue;
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

function isRecoverableMaxOutputIncomplete(params: {
  response: {
    incomplete_details?: { reason?: string | null } | null;
  };
  hasVisibleOutput: boolean;
}): boolean {
  return (
    params.hasVisibleOutput &&
    params.response.incomplete_details?.reason === "max_output_tokens"
  );
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
  maxOutputTokens,
  signal,
}: StreamCompletionParams): Promise<StreamCompletionResult> {
  if (provider === "cli") {
    const result = await runCliCompletion({
      systemPrompt,
      userPrompt,
      reasoningEffort,
      signal,
    });

    async function* outputStream(): AsyncGenerator<string, void, void> {
      yield result.text;
    }

    return {
      stream: outputStream(),
      usagePromise: Promise.resolve(result.usage),
    };
  }

  const client = createClient(provider, resolveApiKey(provider, apiKey));
  const stream = await client.responses.create(
    {
      model,
      stream: true,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    },
    signal ? { signal } : undefined,
  );

  let usageSettled = false;
  let resolveUsage!: (usage: GenerationTokenUsage | null) => void;
  const usagePromise = new Promise<GenerationTokenUsage | null>((resolve) => {
    resolveUsage = resolve;
  });

  async function* outputStream(): AsyncGenerator<string, void, void> {
    let responseId: string | undefined;
    let finalUsage: GenerationTokenUsage | null = null;
    let hasVisibleOutput = false;

    try {
      for await (const event of stream) {
        const response = "response" in event ? event.response : undefined;
        if (response?.id) {
          responseId = response.id;
        }

        if (event.type === "response.output_text.delta") {
          if (event.delta) {
            hasVisibleOutput = true;
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
          if (
            isRecoverableMaxOutputIncomplete({
              response: event.response,
              hasVisibleOutput,
            })
          ) {
            finalUsage =
              normalizeGenerationUsage(event.response.usage) ?? finalUsage;
            continue;
          }

          throw new Error(getResponseFailureMessage(event.response));
        }

        if (event.type === "error") {
          const message = event.message ?? "OpenAI stream failed.";
          throw new Error(message);
        }
      }

      if (!finalUsage) {
        try {
          finalUsage = await retrieveUsageFromResponseId(
            client,
            responseId,
            signal,
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
}

export async function countInputTokens({
  provider,
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  reasoningEffort,
}: CountInputTokensParams): Promise<number> {
  if (provider === "cli") {
    return estimateTokens(`${systemPrompt}\n${userPrompt}`);
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
  maxOutputTokens,
  signal,
}: StructuredCompletionParams<T>): Promise<{
  output: T;
  rawText: string;
  usage: GenerationTokenUsage | null;
}> {
  if (provider === "cli") {
    const result = await runCliCompletion({
      systemPrompt: `${systemPrompt}\n\nReturn only valid JSON for the ${schemaName} schema. Do not wrap it in markdown fences. Include nullable fields explicitly with null when there is no value. Do not include literal newlines inside JSON string values; escape them as \\n when needed. For diagram_graph ids, use lowercase snake_case matching /^[a-z][a-z0-9_]*$/. For diagram_graph edges, use from/to exactly, not source/target. For node shape, use only box, database, queue, document, circle, hexagon, or null.`,
      userPrompt,
      reasoningEffort,
      signal,
    });
    const { rawText, parsed: parsedJson } = parseCliJsonObject(result.text);
    const parsed = normalizeCliStructuredOutput(
      schemaName,
      parsedJson,
    );
    const schemaResult = schema.safeParse(parsed);
    if (!schemaResult.success) {
      throw new Error(
        `CLI structured output failed validation: ${schemaResult.error.message}`,
      );
    }

    return {
      output: schemaResult.data,
      rawText,
      usage: result.usage,
    };
  }

  const client = createClient(provider, resolveApiKey(provider, apiKey));

  try {
    const response = await client.responses.parse(
      {
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
