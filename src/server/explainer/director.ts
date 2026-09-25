import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
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

type Effort = "low" | "medium" | "high";

/** Which model writes and designs a film, and how hard it thinks. */
export interface Planner {
  model: string;
  effort: Effort;
  /** A different model for the scene designers; `model` then only directs. */
  designer?: { model: string; effort: Effort };
}

function readEffort(name: string, fallback: Effort): Effort {
  const value = process.env[name]?.trim();
  return value === "low" || value === "medium" || value === "high"
    ? value
    : fallback;
}

/**
 * Claude Opus: the better storyteller (see experiments/video-models). It
 * makes the films the most people will watch: big repositories, a priority
 * visitor's first video each day, and the operator's.
 */
export function premiumPlanner(): Planner {
  return {
    model: process.env.VIDEO_PLANNER_MODEL?.trim() || "claude-opus-5-5",
    effort: readEffort("VIDEO_PLANNER_EFFORT", "low"),
  };
}

/**
 * Every other film: Claude Opus writes the script (one call, where the story
 * is made) and GPT-6 Sol at medium effort designs the scenes. Blind-judged
 * about level with Opus alone and faster than Sol alone (see
 * experiments/video-bespoke). VIDEO_STANDARD_DIRECTOR_MODEL set to the
 * standard model makes Sol do both.
 */
export function standardPlanner(): Planner {
  const designer = {
    model: process.env.VIDEO_STANDARD_MODEL?.trim() || "gpt-6-sol",
    effort: readEffort("VIDEO_STANDARD_EFFORT", "medium"),
  };
  const director =
    process.env.VIDEO_STANDARD_DIRECTOR_MODEL?.trim() || "claude-opus-5-5";
  if (director === designer.model) return designer;
  return {
    model: director,
    effort: readEffort("VIDEO_PLANNER_EFFORT", "low"),
    designer,
  };
}

/** How a film's models are recorded: "director+designer" when they differ. */
function plannerModel(planner: Planner): string {
  return planner.designer && planner.designer.model !== planner.model
    ? `${planner.model}+${planner.designer.model}`
    : planner.model;
}

/** Whether the standard planner can run here (it needs an OpenAI key). */
export function hasStandardPlanner(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

const isOpenAIModel = (model: string) => /^gpt-/i.test(model);

// OpenAI list prices in USD per million tokens; cached input is billed at
// 0.1× input, with no charge for writing the cache. Checked 2026-09-25.
const OPENAI_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
};

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

/**
 * Every call sends the same tools, system prompt and repository block, and marks
 * the repository block for caching, so the designers after the director pay
 * cache-read prices for the bulk of their input.
 */
/** A picture from the README the writers may look at and put on screen. */
export interface FilmImage {
  id: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  /** Base64 bytes. */
  data: string;
  width: number;
  height: number;
}

/** Prompt overrides, for experiments. */
export interface FilmPrompts {
  system?: string;
  directorTask?: string;
  designerTask?: typeof designerTask;
}

interface ToolCall {
  model: string;
  context: string;
  images: FilmImage[];
  system: string;
  task: string;
  tool: string;
  effort: Effort;
  usage: ModelUsage;
  signal?: AbortSignal;
}

async function callTool(
  params: ToolCall & { client: Anthropic | OpenAI },
): Promise<Json> {
  const { client } = params;
  return client instanceof OpenAI
    ? callOpenAITool({ ...params, client })
    : callClaudeTool({ ...params, client });
}

async function callClaudeTool(
  params: ToolCall & { client: Anthropic },
): Promise<Json> {
  const { client, model, usage } = params;
  const stream = client.messages.stream(
    {
      model,
      max_tokens: MAX_TOKENS,
      system: params.system,
      tools: [SCRIPT_TOOL, SHOTS_TOOL] as Anthropic.Tool[],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            // Pictures sit inside the cached prefix, before the repository text.
            ...params.images.map((image) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: image.mediaType,
                data: image.data,
              },
            })),
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

/**
 * The same call on the OpenAI Responses API: the same tools (not strict: the
 * shot schema is too large for strict mode), instructions and repository
 * block. OpenAI caches the shared prefix on its own.
 */
async function callOpenAITool(
  params: ToolCall & { client: OpenAI },
): Promise<Json> {
  const { client, model, usage } = params;
  const response = await client.responses.create(
    {
      model,
      instructions: params.system,
      tools: [SCRIPT_TOOL, SHOTS_TOOL].map((tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
        strict: false,
      })),
      tool_choice: { type: "function", name: params.tool },
      input: [
        {
          role: "user",
          content: [
            ...params.images.map((image) => ({
              type: "input_image" as const,
              image_url: `data:${image.mediaType};base64,${image.data}`,
              detail: "low" as const,
            })),
            { type: "input_text", text: params.context },
            { type: "input_text", text: params.task },
          ],
        },
      ],
      reasoning: { effort: params.effort },
      max_output_tokens: MAX_TOKENS,
    },
    { signal: params.signal },
  );
  const u = response.usage;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const price = OPENAI_PRICES[model];
  usage.calls += 1;
  usage.inputTokens += u?.input_tokens ?? 0;
  usage.outputTokens += u?.output_tokens ?? 0;
  if (price && u && usage.costUsd !== null)
    usage.costUsd +=
      ((u.input_tokens - cached) * price.input +
        cached * price.input * 0.1 +
        u.output_tokens * price.output) /
      1_000_000;
  else usage.costUsd = null;
  const refused = response.output.some(
    (item) =>
      item.type === "message" &&
      item.content.some((part) => part.type === "refusal"),
  );
  if (refused)
    throw new VideoRefusalError("The model declined this repository.");
  if (response.status !== "completed")
    throw new UnusableReplyError(
      `The model stopped early in ${params.tool}: ${response.incomplete_details?.reason ?? response.status}.`,
    );
  const call = response.output.find(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
      item.type === "function_call" && item.name === params.tool,
  );
  if (!call)
    throw new UnusableReplyError(`The model did not call ${params.tool}.`);
  try {
    return JSON.parse(call.arguments) as Json;
  } catch {
    throw new UnusableReplyError(`The model sent broken ${params.tool} JSON.`);
  }
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

const clientFor = (model: string) =>
  isOpenAIModel(model) ? new OpenAI() : new Anthropic();

export function createFilmWriters(
  input: RepositoryContextInput,
  planner: Planner = premiumPlanner(),
  options: { images?: FilmImage[]; prompts?: FilmPrompts } = {},
) {
  const designerPlanner = planner.designer ?? planner;
  let director = { model: planner.model, effort: planner.effort };
  let client = clientFor(director.model);
  const designClient =
    designerPlanner.model === director.model
      ? client
      : clientFor(designerPlanner.model);
  let model = plannerModel(planner);
  const images = options.images ?? [];
  const system = options.prompts?.system ?? SHOT_SYSTEM;
  const design = options.prompts?.designerTask ?? designerTask;
  const context = repositoryContext(input, images);
  const usage: ModelUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  /** The script, written by the current director. */
  async function directWith(signal?: AbortSignal): Promise<Script> {
    // A script too thin to film is an unusable reply like any other.
    const write = (task: string) =>
      withRetry(async () => {
        const raw = await callTool({
          client,
          model: director.model,
          context,
          images,
          system,
          task,
          tool: SCRIPT_TOOL.name,
          effort: director.effort,
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
    const script = await write(options.prompts?.directorTask ?? DIRECTOR_TASK);
    const words = scriptWordCount(script);
    if (words <= SCRIPT_WORD_LIMIT) return script;
    // The voice runs at a natural pace, so a long script means a long film.
    // A failed shortening only leaves the first draft to be judged alone.
    let trimmed: Script | null = null;
    try {
      trimmed = await write(
        trimTask({
          script: JSON.stringify(script),
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
  }

  return {
    /** The models making the film (see plannerModel). */
    get model() {
      return model;
    },
    usage,
    /** Write the shared prompt cache (for callers that design without directing). */
    async warmup(): Promise<void> {
      if (client instanceof OpenAI) return;
      await client.messages.create({
        model: director.model,
        max_tokens: 16,
        system,
        tools: [SCRIPT_TOOL, SHOTS_TOOL] as Anthropic.Tool[],
        messages: [
          {
            role: "user",
            content: [
              ...images.map((image) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: image.mediaType,
                  data: image.data,
                },
              })),
              {
                type: "text",
                text: context,
                cache_control: { type: "ephemeral" },
              },
              { type: "text", text: "Reply with OK." },
            ],
          },
        ],
      });
    },
    /**
     * The script, checked and within length, before any parallel work starts.
     * When a separate director fails (out of credit, overloaded, an unusable
     * reply), the designers' model writes the script instead, so the film is
     * still made. A refusal or the deadline ends the run.
     */
    async direct(signal?: AbortSignal): Promise<Script> {
      try {
        return await directWith(signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (
          error instanceof VideoRefusalError ||
          director.model === designerPlanner.model
        )
          throw error;
        console.warn(
          JSON.stringify({
            event: "video.director.fallback",
            from: director.model,
            to: designerPlanner.model,
            error:
              error instanceof Error ? error.message.slice(0, 200) : "unknown",
          }),
        );
        director = designerPlanner;
        client = designClient;
        model = designerPlanner.model;
        return directWith(signal);
      }
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
                  client: designClient,
                  model: designerPlanner.model,
                  context,
                  images,
                  system,
                  task: design({
                    script: outline,
                    scenes: [group.scene],
                    beats: group.beats,
                  }),
                  tool: SHOTS_TOOL.name,
                  effort: designerPlanner.effort,
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
