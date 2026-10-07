/**
 * Head-to-head speed on ONE recorded production diagram request
 * (~/reference/aws/bench/cap/req-0.json, honojs/hono): the same system and
 * user prompt and the same output schema go to GPT-6 Luna in both OpenAI lanes
 * and to Claude Haiku 5.5 at each effort, one request at a time, in rounds.
 *
 *   bun --env-file=/home/ahmed/repos/gitdiagram/.env --conditions=react-server experiments/diagram-haiku/bench.ts <rounds> <target,...>
 *
 * Targets: luna-priority luna-default haiku-nothink haiku-low haiku-medium haiku-high
 * Appends one line per request to out/bench.jsonl.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import {
  architectureOutputSchema,
  readArchitectureProgress,
} from "~/server/generate/architecture-output";
import { callCostUsd, type CallUsage } from "./cost";

const body = JSON.parse(
  readFileSync(`${homedir()}/reference/aws/bench/cap/req-0.json`, "utf8"),
) as {
  input: Array<{ role: string; content: string }>;
  [key: string]: unknown;
};
const system = body.input.find((entry) => entry.role === "system")!.content;
const user = body.input.find((entry) => entry.role === "user")!.content;
const openai = new OpenAI({ maxRetries: 0 });
const anthropic = new Anthropic({
  apiKey: readFileSync(
    `${homedir()}/.config/gitdiagram/anthropic-api-key`,
    "utf8",
  ).trim(),
  maxRetries: 0,
});

async function once(target: string) {
  const started = performance.now();
  let text = "";
  let firstText: number | null = null;
  let firstExplanation: number | null = null;
  const onChunk = (chunk: string) => {
    firstText ??= performance.now() - started;
    text += chunk;
    if (firstExplanation === null && readArchitectureProgress(text).text)
      firstExplanation = performance.now() - started;
  };
  let usage: CallUsage;
  if (target.startsWith("luna")) {
    const stream = await openai.responses.create({
      ...(body as object),
      service_tier: target === "luna-priority" ? "priority" : "default",
      stream: true,
    } as never);
    let final: OpenAI.Responses.Response | undefined;
    for await (const event of stream as unknown as AsyncIterable<OpenAI.Responses.ResponseStreamEvent>) {
      if (event.type === "response.output_text.delta") onChunk(event.delta);
      if (event.type === "response.completed") final = event.response;
    }
    if (!final?.usage) throw new Error("no usage");
    usage = {
      model: "gpt-6-luna",
      inputTokens: final.usage.input_tokens,
      cachedInputTokens: final.usage.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens:
        (
          final.usage.input_tokens_details as unknown as {
            cache_write_tokens?: number;
          }
        )?.cache_write_tokens ?? 0,
      outputTokens: final.usage.output_tokens,
      reasoningTokens: final.usage.output_tokens_details?.reasoning_tokens ?? 0,
      serviceTier: final.service_tier ?? null,
    };
  } else {
    const stream = anthropic.messages.stream({
      model: "claude-haiku-5-5",
      max_tokens: 32_000,
      system,
      messages: [{ role: "user", content: user }],
      ...(target === "haiku-nothink"
        ? { thinking: { type: "disabled" as const } }
        : {}),
      output_config: {
        effort: (target === "haiku-nothink" ? "low" : target.split("-")[1]) as
          "low" | "medium" | "high",
        format: zodOutputFormat(architectureOutputSchema),
      },
    });
    stream.on("text", onChunk);
    const message = await stream.finalMessage();
    usage = {
      model: "claude-haiku-5-5",
      inputTokens: message.usage.input_tokens,
      cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
      reasoningTokens:
        (
          message.usage as unknown as {
            output_tokens_details?: { thinking_tokens?: number };
          }
        ).output_tokens_details?.thinking_tokens ?? 0,
      serviceTier: message.usage.service_tier ?? null,
    };
  }
  const total = performance.now() - started;
  architectureOutputSchema.parse(JSON.parse(text));
  return {
    target,
    firstText: Math.round(firstText ?? 0),
    firstExplanation: Math.round(firstExplanation ?? 0),
    total: Math.round(total),
    ...usage,
    // Visible answer tokens per second once text has started.
    textTokensPerSecond: firstText
      ? +(
          ((usage.outputTokens - usage.reasoningTokens) / (total - firstText)) *
          1000
        ).toFixed(1)
      : null,
    costUsd: callCostUsd(usage),
  };
}

const rounds = Number(process.argv[2] ?? 3);
const targets = (
  process.argv[3] ?? "luna-priority,luna-default,haiku-low,haiku-medium"
).split(",");
for (let round = 0; round < rounds; round++)
  for (const target of targets) {
    const result = await once(target).catch((error: unknown) => ({
      target,
      error: String(error).slice(0, 300),
    }));
    console.info(JSON.stringify(result));
    await appendFile(
      join(import.meta.dir, "out", "bench.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...result })}\n`,
    );
    if ("costUsd" in result)
      await appendFile(
        join(import.meta.dir, "out", "spend.jsonl"),
        `${JSON.stringify({ label: `bench:${target}`, costUsd: result.costUsd, at: new Date().toISOString() })}\n`,
      );
  }
