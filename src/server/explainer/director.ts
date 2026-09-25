import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { claudeCostUsd, claudePrice } from "~/server/anthropic-pricing";
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
// Thinking counts against max_tokens too, so leave it room beyond the tool call.
const MAX_TOKENS = 32_000;
// A script over SCRIPT_WORD_LIMIT goes back once to be shortened. If neither
// version fits, one a little over (a few seconds more film) is still used.
export const SCRIPT_HARD_WORD_LIMIT = Math.round(SCRIPT_WORD_LIMIT * 1.2);

interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

type Json = Record<string, unknown>;

/** The model declined the repository; asking again would decline again. */
export class VideoRefusalError extends Error {}

/**
 * The reply came back unusable (no tool call, cut off at max_tokens, or a
 * script too thin to film), so one more try may help. Rate limits and server
 * errors are the SDK's to retry; nothing else is retried.
 */
class UnusableReplyError extends Error {}

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
      max_tokens: MAX_TOKENS,
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
  const price = claudePrice(model);
  usage.calls += 1;
  usage.inputTokens += u.input_tokens + cacheWrite + cacheRead;
  usage.outputTokens += u.output_tokens;
  if (price && usage.costUsd !== null)
    usage.costUsd += claudeCostUsd(price, {
      input: u.input_tokens,
      // The repository block is cached for the default five minutes.
      cacheWrite5m: cacheWrite,
      cacheRead,
      output: u.output_tokens,
    });
  else usage.costUsd = null;
  if (message.stop_reason === "refusal")
    throw new VideoRefusalError("The model declined this repository.");
  // A tool call cut off here still parses, as whatever came before the cut.
  if (message.stop_reason === "max_tokens")
    throw new UnusableReplyError(
      `The model ran out of room in ${params.tool}.`,
    );
  const call = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === params.tool,
  );
  if (!call)
    throw new UnusableReplyError(`The model did not call ${params.tool}.`);
  return call.input as Json;
}

async function withRetry<T>(run: () => Promise<T>, signal?: AbortSignal) {
  try {
    return await run();
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof UnusableReplyError)) throw error;
    console.warn(
      JSON.stringify({
        event: "video.model.retry",
        error: error.message.slice(0, 200),
      }),
    );
    return run();
  }
}

/** Scenes as the designers get them: each run of adjacent beats in one scene. */
export function designGroups(
  script: Script,
): Array<{ scene: string; beats: number[] }> {
  const groups: Array<{ scene: string; beats: number[] }> = [];
  script.beats.forEach((beat, index) => {
    const last = groups.at(-1);
    if (last && last.scene === beat.scene) last.beats.push(index);
    else groups.push({ scene: beat.scene, beats: [index] });
  });
  return groups;
}

/**
 * The script to film: the first draft that fits the word limit, else the
 * shorter draft while it stays within the hard limit. Null when none does.
 */
export function pickScript(drafts: Array<Script | null>): Script | null {
  const counted = drafts
    .filter((draft): draft is Script => draft !== null)
    .map((draft) => ({ draft, words: scriptWordCount(draft) }));
  const fits = counted.find(({ words }) => words <= SCRIPT_WORD_LIMIT);
  if (fits) return fits.draft;
  const shortest = counted.sort((a, b) => a.words - b.words)[0];
  return shortest && shortest.words <= SCRIPT_HARD_WORD_LIMIT
    ? shortest.draft
    : null;
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
    /** The script, checked and within length, before any parallel work starts. */
    async direct(signal?: AbortSignal): Promise<Script> {
      // A script too thin to film is an unusable reply like any other.
      const write = (task: string) =>
        withRetry(async () => {
          const raw = await callTool({
            client,
            model,
            context,
            task,
            tool: SCRIPT_TOOL.name,
            effort: "low",
            usage,
            signal,
          });
          try {
            return normalizeScript(raw, input.repo, context);
          } catch (error) {
            throw new UnusableReplyError(
              error instanceof Error ? error.message : "Unusable script.",
            );
          }
        }, signal);
      const script = await write(DIRECTOR_TASK);
      const words = scriptWordCount(script);
      if (words <= SCRIPT_WORD_LIMIT) return script;
      // The voice runs at a natural pace, so a long script means a long film.
      // A failed shortening only leaves the first draft to be judged alone.
      let trimmed: Script | null = null;
      try {
        trimmed = await write(
          trimTask({
            // As written, delivery tags included, so the trim keeps them.
            script: JSON.stringify({
              ...script,
              beats: script.beats.map(({ spoken, ...beat }) => ({
                ...beat,
                narration: spoken,
              })),
            }),
            words,
            target: SCRIPT_WORD_TARGET,
          }),
        );
      } catch (error) {
        signal?.throwIfAborted();
        console.warn(
          JSON.stringify({
            event: "video.script.trim_failed",
            error:
              error instanceof Error ? error.message.slice(0, 200) : "unknown",
          }),
        );
      }
      const chosen = pickScript([script, trimmed]);
      console.info(
        JSON.stringify({
          event: "video.script.trimmed",
          from: words,
          to: trimmed ? scriptWordCount(trimmed) : null,
          chosen: chosen ? scriptWordCount(chosen) : null,
        }),
      );
      if (!chosen)
        throw new Error(
          `The script stayed too long (${words} words, hard limit ${SCRIPT_HARD_WORD_LIMIT}).`,
        );
      return chosen;
    },

    /** One designer per scene, all at once; a failed scene falls back to plain type. */
    async design(
      script: Script,
      signal?: AbortSignal,
      onDesigned?: () => void,
    ): Promise<Map<number, Json>> {
      const scenes = designGroups(script);
      const outline = scriptForDesigners(script);
      const designed = new Map<number, Json>();
      // Settled, not raced: once aborted, no designer is still running (and
      // billing) when this returns.
      await Promise.allSettled(
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
      signal?.throwIfAborted();
      return designed;
    },
  };
}
