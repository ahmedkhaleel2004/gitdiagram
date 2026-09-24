import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { VIDEO_PLAN_SCHEMA } from "./plan-schema";
import {
  VIDEO_PLANNER_SYSTEM,
  videoPlannerPrompt,
  type VideoPromptInput,
} from "./plan-prompt";

export const DEFAULT_VIDEO_PLANNER_MODEL = "claude-opus-5-5";

// USD per million tokens at API list prices, for the cost line in stats.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
};

export interface PlannerResult {
  plan: unknown;
  planner: "api" | "cli";
  model: string;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export function videoPlannerModel(): string {
  return process.env.VIDEO_PLANNER_MODEL?.trim() || DEFAULT_VIDEO_PLANNER_MODEL;
}

/** API key in any environment; the local Claude Code login only in development. */
export function videoPlannerBackend(): "api" | "cli" | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "api";
  if (
    process.env.NODE_ENV === "development" &&
    process.env.VIDEO_PLANNER_ALLOW_CLI !== "0"
  )
    return "cli";
  return null;
}

export async function planVideo(
  input: VideoPromptInput,
  signal?: AbortSignal,
): Promise<PlannerResult> {
  const backend = videoPlannerBackend();
  if (!backend)
    throw new Error("Video planning needs ANTHROPIC_API_KEY on the server.");
  const model = videoPlannerModel();
  const prompt = videoPlannerPrompt(input);
  // One retry absorbs a transient API or CLI failure; a second failure is real.
  try {
    return backend === "api"
      ? await planWithApi(model, prompt, signal)
      : await planWithCli(model, prompt, signal);
  } catch (error) {
    signal?.throwIfAborted();
    console.warn(
      JSON.stringify({
        event: "video.planner.retry",
        backend,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return backend === "api"
      ? await planWithApi(model, prompt, signal)
      : await planWithCli(model, prompt, signal);
  }
}

const PLAN_TOOL = "write_video_plan";

// The plan schema is too rich for strict structured output (the API rejects the
// compiled grammar), so it rides on a non-strict tool: the input is guaranteed
// JSON, and normalizeVideoPlan enforces the shape.
async function planWithApi(
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<PlannerResult> {
  const client = new Anthropic();
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 16_000,
      system: `${VIDEO_PLANNER_SYSTEM}\n\nSubmit the finished plan by calling the ${PLAN_TOOL} tool exactly once.`,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: PLAN_TOOL,
          description: "Submit the finished explainer video plan.",
          input_schema: VIDEO_PLAN_SCHEMA as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
    },
    { signal },
  );
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal")
    throw new Error("The planner declined this repository.");
  if (message.stop_reason === "max_tokens")
    throw new Error("The planner ran out of output tokens.");
  const call = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === PLAN_TOOL,
  );
  if (!call) throw new Error("The planner did not submit a plan.");
  const usage = message.usage;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const price = PRICING[model];
  return {
    plan: call.input,
    planner: "api",
    model,
    costUsd: price
      ? (usage.input_tokens * price.input +
          cacheWrite * price.input * 1.25 +
          cacheRead * price.input * 0.1 +
          usage.output_tokens * price.output) /
        1_000_000
      : null,
    inputTokens: usage.input_tokens + cacheWrite + cacheRead,
    outputTokens: usage.output_tokens,
  };
}

// Development only: the local Claude Code login, which reports cost at list prices.
async function planWithCli(
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<PlannerResult> {
  // An empty working directory keeps project CLAUDE.md files out of the context.
  const cwd = await mkdtemp(join(tmpdir(), "gitdiagram-video-"));
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "claude",
        [
          "-p",
          "--model",
          model,
          "--effort",
          "low",
          "--system-prompt",
          VIDEO_PLANNER_SYSTEM,
          "--json-schema",
          JSON.stringify(VIDEO_PLAN_SCHEMA),
          "--tools",
          "",
          "--strict-mcp-config",
          "--disable-slash-commands",
          "--no-session-persistence",
          "--output-format",
          "json",
        ],
        { cwd, signal, stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(out)
          : reject(
              new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`),
            ),
      );
      child.stdin.end(prompt);
    });
    const result = JSON.parse(stdout) as {
      is_error?: boolean;
      result?: string;
      structured_output?: unknown;
      total_cost_usd?: number;
      modelUsage?: Record<
        string,
        {
          inputTokens?: number;
          cacheCreationInputTokens?: number;
          cacheReadInputTokens?: number;
          outputTokens?: number;
        }
      >;
    };
    if (result.is_error) throw new Error(`planner error: ${result.result}`);
    const text = String(result.result ?? "");
    const plan =
      result.structured_output ??
      JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const usage = result.modelUsage?.[model];
    return {
      plan,
      planner: "cli",
      model,
      costUsd: result.total_cost_usd ?? null,
      inputTokens: usage
        ? (usage.inputTokens ?? 0) +
          (usage.cacheCreationInputTokens ?? 0) +
          (usage.cacheReadInputTokens ?? 0)
        : null,
      outputTokens: usage?.outputTokens ?? null,
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
