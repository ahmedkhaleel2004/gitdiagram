import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { RepositoryContextInput } from "./repository";
import {
  DIRECTOR_TASK,
  SHOT_SYSTEM,
  designerTask,
  repositoryContext,
  trimTask,
} from "./shot-prompt";
import {
  SCRIPT_TOOL,
  SCRIPT_WORD_LIMIT,
  SCRIPT_WORD_TARGET,
  SHOTS_TOOL,
  normalizeScript,
  scriptForDesigners,
  scriptWordCount,
  type Script,
} from "./shots";

const DEFAULT_VIDEO_MODEL = "claude-opus-5-5";
// USD per million tokens at API list prices; cache writes cost 1.25×, reads 0.1×.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
};

interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

type Json = Record<string, unknown>;

function videoModel(): string {
  return process.env.VIDEO_PLANNER_MODEL?.trim() || DEFAULT_VIDEO_MODEL;
}

/**
 * Every call sends the same tools, system prompt and repository block, and marks
 * the repository block for caching, so the designers after the director pay
 * cache-read prices for the bulk of their input.
 */
async function callTool(params: {
  client: Anthropic;
  model: string;
  context: string;
  task: string;
  tool: string;
  effort: "low" | "medium";
  usage: ModelUsage;
  signal?: AbortSignal;
}): Promise<Json> {
  const { client, model, usage } = params;
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 16_000,
      system: SHOT_SYSTEM,
      tools: [SCRIPT_TOOL, SHOTS_TOOL] as Anthropic.Tool[],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: params.context,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: params.task },
          ],
        },
      ],
      output_config: { effort: params.effort },
    },
    { signal: params.signal },
  );
  const message = await stream.finalMessage();
  const u = message.usage;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const price = PRICING[model];
  usage.calls += 1;
  usage.inputTokens += u.input_tokens + cacheWrite + cacheRead;
  usage.outputTokens += u.output_tokens;
  if (price && usage.costUsd !== null)
    usage.costUsd +=
      (u.input_tokens * price.input +
        cacheWrite * price.input * 1.25 +
        cacheRead * price.input * 0.1 +
        u.output_tokens * price.output) /
      1_000_000;
  else usage.costUsd = null;
  if (message.stop_reason === "refusal")
    throw new Error("The model declined this repository.");
  const call = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === params.tool,
  );
  if (!call) throw new Error(`The model did not call ${params.tool}.`);
  return call.input as Json;
}

async function withRetry<T>(run: () => Promise<T>, signal?: AbortSignal) {
  try {
    return await run();
  } catch (error) {
    signal?.throwIfAborted();
    console.warn(
      JSON.stringify({
        event: "video.model.retry",
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return run();
  }
}

export function createFilmWriters(input: RepositoryContextInput) {
  const client = new Anthropic();
  const model = videoModel();
  const context = repositoryContext(input);
  const usage: ModelUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  return {
    model,
    usage,
    async direct(signal?: AbortSignal): Promise<Script> {
      const write = (task: string) =>
        withRetry(
          () =>
            callTool({
              client,
              model,
              context,
              task,
              tool: SCRIPT_TOOL.name,
              effort: "low",
              usage,
              signal,
            }),
          signal,
        );
      const script = normalizeScript(await write(DIRECTOR_TASK), input.repo);
      const words = scriptWordCount(script);
      if (words <= SCRIPT_WORD_LIMIT) return script;
      // The voice runs at a natural pace, so a long script means a long film.
      const trimmed = normalizeScript(
        await write(
          trimTask({
            script: JSON.stringify(script),
            words,
            target: SCRIPT_WORD_TARGET,
          }),
        ),
        input.repo,
      );
      console.info(
        JSON.stringify({
          event: "video.script.trimmed",
          from: words,
          to: scriptWordCount(trimmed),
        }),
      );
      return scriptWordCount(trimmed) < words ? trimmed : script;
    },

    /** One designer per scene, all at once; a failed scene falls back to plain type. */
    async design(
      script: Script,
      signal?: AbortSignal,
      onDesigned?: () => void,
    ): Promise<Map<number, Json>> {
      const scenes: Array<{ scene: string; beats: number[] }> = [];
      script.beats.forEach((beat, index) => {
        const last = scenes.at(-1);
        if (last && last.scene === beat.scene) last.beats.push(index);
        else scenes.push({ scene: beat.scene, beats: [index] });
      });
      const outline = scriptForDesigners(script);
      const designed = new Map<number, Json>();
      await Promise.all(
        scenes.map(async (group) => {
          try {
            const raw = await withRetry(
              () =>
                callTool({
                  client,
                  model,
                  context,
                  task: designerTask({
                    script: outline,
                    scenes: [group.scene],
                    beats: group.beats,
                  }),
                  tool: SHOTS_TOOL.name,
                  effort: "low",
                  usage,
                  signal,
                }),
              signal,
            );
            const shots = Array.isArray(raw.shots) ? raw.shots : [];
            for (const shot of shots) {
              const beat = Number((shot as Json).beat);
              if (group.beats.includes(beat)) designed.set(beat, shot as Json);
            }
          } catch (error) {
            signal?.throwIfAborted();
            console.warn(
              JSON.stringify({
                event: "video.designer.failed",
                scene: group.scene,
                error:
                  error instanceof Error
                    ? error.message.slice(0, 200)
                    : "unknown",
              }),
            );
          } finally {
            onDesigned?.();
          }
        }),
      );
      return designed;
    },
  };
}
