import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import type { AiMode, AiProvider } from "~/features/admin/visibility";
import { claudeCostUsd, claudePrice } from "~/server/anthropic-pricing";
import { modelFetchOption } from "~/server/model-fetch";

// Asks one question the way a person would in ChatGPT or Claude: no system
// prompt of ours beyond, in search mode, a nudge to check the web first (left
// alone, the models often answer from memory even with search on, and the
// memory mode already measures that). Low effort and capped output keep the
// daily run near a dollar.

const SEARCH_NUDGE =
  "Search the web to check what is current before you answer.";

const SEARCH_CALL_USD = 0.01; // both providers: $10 per 1,000 searches
const MAX_OUTPUT_TOKENS = 1_800;

export interface AskResult {
  model: string;
  text: string;
  /** URLs the answer cites. */
  citations: string[];
  /** Every page the search returned (search mode only). */
  sources: string[];
  costUsd: number;
  truncated: boolean;
}

// USD per million tokens. Unknown models are priced as the dearest listed, so
// the cost guard errs high.
const OPENAI_PRICES: Record<
  string,
  { input: number; output: number; cachedRead?: number }
> = {
  "gpt-6.1-sol": { input: 2, output: 10, cachedRead: 0.05 },
  "gpt-6-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-5.6-sol": { input: 4, output: 20 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};

export function aiVisibilityModels(): Record<AiProvider, string> {
  return {
    openai: process.env.AI_VISIBILITY_OPENAI_MODEL?.trim() || "gpt-6.1-sol",
    anthropic:
      process.env.AI_VISIBILITY_ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5",
  };
}

export function providerConfigured(provider: AiProvider): boolean {
  return Boolean(
    (provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY
    )?.trim(),
  );
}

function openAICost(
  model: string,
  usage: OpenAI.Responses.ResponseUsage,
  flex: boolean,
) {
  const price = OPENAI_PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")] ?? {
    input: 10,
    output: 50,
  };
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const written =
    (usage.input_tokens_details as { cache_write_tokens?: number } | undefined)
      ?.cache_write_tokens ?? 0;
  const plain = Math.max(0, usage.input_tokens - cached - written);
  return (
    ((plain * price.input +
      written * price.input * 1.25 +
      cached * price.input * (price.cachedRead ?? 0.1) +
      usage.output_tokens * price.output) *
      (flex ? 0.5 : 1)) /
    1_000_000
  );
}

async function askOpenAI(
  model: string,
  prompt: string,
  mode: AiMode,
  signal: AbortSignal,
): Promise<AskResult> {
  const client = new OpenAI({
    maxRetries: 1,
    timeout: 90_000,
    ...modelFetchOption(),
  });
  const request = (serviceTier: "flex" | "default") =>
    client.responses.create(
      {
        service_tier: serviceTier,
        model,
        input: prompt,
        reasoning: { effort: "low" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
        ...(mode === "search"
          ? {
              instructions: SEARCH_NUDGE,
              tools: [{ type: "web_search", search_context_size: "low" }],
              include: ["web_search_call.action.sources"],
            }
          : {}),
      },
      { signal },
    );
  // Flex processing halves the token price; nobody waits on this run. When
  // flex has no capacity (429), the standard tier answers instead.
  const response = await request("flex").catch((error: unknown) => {
    if (error instanceof OpenAI.RateLimitError && !signal.aborted)
      return request("default");
    throw error;
  });
  const citations: string[] = [];
  const sources: string[] = [];
  let searches = 0;
  for (const item of response.output) {
    if (item.type === "web_search_call") {
      if (item.action?.type === "search") {
        searches += 1;
        for (const source of item.action.sources ?? [])
          if ("url" in source && source.url) sources.push(source.url);
      }
    } else if (item.type === "message") {
      for (const part of item.content)
        if (part.type === "output_text")
          for (const note of part.annotations)
            if (note.type === "url_citation") citations.push(note.url);
    }
  }
  return {
    model,
    text: response.output_text,
    citations,
    sources,
    costUsd:
      (response.usage
        ? openAICost(model, response.usage, response.service_tier === "flex")
        : 0) +
      searches * SEARCH_CALL_USD,
    truncated: response.status === "incomplete",
  };
}

async function askClaude(
  model: string,
  prompt: string,
  mode: AiMode,
  signal: AbortSignal,
): Promise<AskResult> {
  const client = new Anthropic({ maxRetries: 1, timeout: 90_000 });
  const message = await client.messages.create(
    {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
      ...(mode === "search"
        ? {
            system: SEARCH_NUDGE,
            // The basic variant: in a side-by-side it cost half as much as
            // web_search_20260209 (no code-execution filtering pass) and
            // returned proper citations.
            tools: [
              { type: "web_search_20250305", name: "web_search", max_uses: 1 },
            ],
          }
        : {}),
    },
    { signal },
  );
  if (message.stop_reason === "refusal") throw new Error("Claude declined.");
  const citations: string[] = [];
  const sources: string[] = [];
  let text = "";
  for (const block of message.content) {
    if (block.type === "text") {
      text += block.text;
      for (const citation of block.citations ?? [])
        if ("url" in citation && typeof citation.url === "string")
          citations.push(citation.url);
    } else if (
      block.type === "web_search_tool_result" &&
      Array.isArray(block.content)
    ) {
      for (const result of block.content) sources.push(result.url);
    }
  }
  const price = claudePrice(model);
  const usage = message.usage;
  const tokens = {
    input: usage.input_tokens,
    cacheWrite5m: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens,
  };
  return {
    model,
    text,
    citations,
    sources,
    costUsd:
      claudeCostUsd(price ?? { input: 10, output: 50, cacheRead: 1 }, tokens) +
      (usage.server_tool_use?.web_search_requests ?? 0) * SEARCH_CALL_USD,
    truncated: message.stop_reason === "max_tokens",
  };
}

export function askAssistant(
  provider: AiProvider,
  prompt: string,
  mode: AiMode,
  signal: AbortSignal,
): Promise<AskResult> {
  const model = aiVisibilityModels()[provider];
  return provider === "openai"
    ? askOpenAI(model, prompt, mode, signal)
    : askClaude(model, prompt, mode, signal);
}
