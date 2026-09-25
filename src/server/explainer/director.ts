import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { claudeCostUsd, claudePrice } from "~/server/anthropic-pricing";
import {
  createCostSummary,
  normalizeGenerationUsage,
  resolvePricingModel,
} from "~/server/generate/pricing";
import { errorText, logEvent } from "~/server/log";
import { isOpenAIModel } from "./planner";
import type { RepositoryContextInput } from "./repository";
import {
  MAX_BEATS,
  SCRIPT_WORD_LIMIT,
  SCRIPT_WORD_TARGET,
  fitBeats,
  normalizeScript,
  scriptForDesigners,
  scriptWordCount,
  type Script,
} from "./script";
import {
  DIRECTOR_TASK,
  SHOT_SYSTEM,
  designerTask,
  repositoryContext,
  trimTask,
} from "./shot-prompt";
import { SCRIPT_TOOL, SHOTS_TOOL } from "./shot-tools";

// The model-calling layer: the director writes the script, one designer per
// scene turns it into shots. planner.ts decides which models play each role.

export type Effort = "low" | "medium" | "high";

interface Role {
  model: string;
  effort: Effort;
}

/** Which model writes and designs a film, and how hard it thinks. */
export interface Planner extends Role {
  /** A different model for the scene designers; `model` then only directs. */
  designer?: Role;
  /**
   * The model that takes over directing and designing when `model` fails for
   * any reason but a refusal. Without it a separate designer takes over
   * directing.
   */
  fallback?: Role;
}

// Thinking counts against max_tokens too, so leave it room beyond the tool call.
const MAX_TOKENS = 32_000;
// A script over SCRIPT_WORD_LIMIT goes back once to be shortened. If neither
// version fits, one a little over (a few seconds more film) is still used.
export const SCRIPT_HARD_WORD_LIMIT = Math.round(SCRIPT_WORD_LIMIT * 1.2);
// Every call writing the script (first draft, retries, the shortening and a
// fallback model's draft) counts; each can run to MAX_TOKENS.
const MAX_DIRECTOR_CALLS = 3;
// A film with more beats than this undesigned is not worth storing.
const MAX_UNDESIGNED_SHARE = 1 / 3;

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
 * errors before a reply starts are the SDK's to retry.
 */
class UnusableReplyError extends Error {}

/** Even the shortened script runs too long; another model would not help. */
class ScriptTooLongError extends Error {}

/**
 * The Claude API failed after its reply had started streaming (overloaded or
 * a server error); the SDK only retries before the stream starts.
 */
function isMidStreamServerError(error: unknown): boolean {
  return (
    error instanceof Anthropic.APIError &&
    error.status === undefined &&
    (error.type === "overloaded_error" || error.type === "api_error")
  );
}

/** A request either API refused because of an attached picture. */
function isPictureRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return (
    status === 400 && /image/i.test(`${error.message} ${String(code ?? "")}`)
  );
}

/** A picture from the README the writers may look at and put on screen. */
export interface FilmImage {
  id: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  /** Base64 bytes. */
  data: string;
  width: number;
  height: number;
}

interface ToolCall extends Role {
  context: string;
  images: FilmImage[];
  system: string;
  task: string;
  tool: string;
  /**
   * Mark everything before the task for caching, when later calls on the
   * same model will read it. A write costs 1.25× input, so one-off calls skip it.
   */
  cache: boolean;
  usage: ModelUsage;
  signal?: AbortSignal;
}

function addUsage(
  usage: ModelUsage,
  tokens: { input: number; output: number },
  costUsd: number | null,
) {
  usage.calls += 1;
  usage.inputTokens += tokens.input;
  usage.outputTokens += tokens.output;
  usage.costUsd =
    usage.costUsd === null || costUsd === null ? null : usage.costUsd + costUsd;
}

/**
 * Every call sends the same tools, system prompt, pictures and repository
 * block in that order, so a cached prefix is shared by every call on one model.
 */
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
              ...(params.cache
                ? { cache_control: { type: "ephemeral" as const } }
                : {}),
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
  addUsage(
    usage,
    { input: u.input_tokens + cacheWrite + cacheRead, output: u.output_tokens },
    price &&
      claudeCostUsd(price, {
        input: u.input_tokens,
        // The repository block is cached for the default five minutes.
        cacheWrite5m: cacheWrite,
        cacheRead,
        output: u.output_tokens,
      }),
  );
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

const OPENAI_TOOLS = [SCRIPT_TOOL, SHOTS_TOOL].map((tool) => ({
  type: "function" as const,
  name: tool.name,
  description: tool.description,
  parameters: tool.input_schema,
  strict: false,
}));

/**
 * The Responses API request: the same tools (not strict: the shot schema is
 * too large for strict mode), then the system prompt as a developer message,
 * the pictures and the repository block, then the task. On GPT-5.6 and later
 * the automatic cache breakpoint falls at the end of the last user message,
 * so every designer would write its own copy (1.25× input) and none would
 * read another's; caching is explicit instead, with the one breakpoint after
 * the repository block, and the task after it is never written.
 */
function openAIRequest(
  params: Omit<ToolCall, "usage" | "signal">,
  prewarm = false,
) {
  return {
    model: params.model,
    store: false,
    tools: OPENAI_TOOLS,
    tool_choice: { type: "function" as const, name: params.tool },
    reasoning: { effort: params.effort },
    max_output_tokens: MAX_TOKENS,
    prompt_cache_options: {
      mode: "explicit" as const,
      ...(prewarm ? { prewarm: true } : {}),
    },
    input: [
      {
        role: "developer" as const,
        content: [{ type: "input_text" as const, text: params.system }],
      },
      {
        role: "user" as const,
        content: [
          ...params.images.map((image) => ({
            type: "input_image" as const,
            image_url: `data:${image.mediaType};base64,${image.data}`,
            detail: "low" as const,
          })),
          {
            type: "input_text" as const,
            text: params.context,
            ...(params.cache
              ? { prompt_cache_breakpoint: { mode: "explicit" as const } }
              : {}),
          },
        ],
      },
      ...(prewarm
        ? []
        : [
            {
              role: "user" as const,
              content: [{ type: "input_text" as const, text: params.task }],
            },
          ]),
    ],
  };
}

/**
 * List-price cost of a response: cache reads at 0.1× input and cache writes
 * at 1.25× (GPT-5.6 and later), the rest at the input rate.
 */
function openAICostUsd(
  model: string,
  response: Pick<OpenAI.Responses.Response, "usage" | "service_tier">,
): number | null {
  if (!response.usage || !resolvePricingModel(model)) return null;
  return createCostSummary({
    kind: "actual",
    model,
    approximate: false,
    usage: normalizeGenerationUsage(response.usage, response.service_tier)!,
  }).amountUsd;
}

async function callOpenAITool(
  params: ToolCall & { client: OpenAI },
): Promise<Json> {
  const { client, model, usage } = params;
  const response = await client.responses.create(openAIRequest(params), {
    signal: params.signal,
  });
  addUsage(
    usage,
    {
      input: response.usage?.input_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
    },
    openAICostUsd(model, response),
  );
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

/**
 * One more try after an unusable reply or a Claude reply that failed
 * mid-stream, while `mayRetry` allows it. Nothing else is retried.
 */
async function withRetry<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
  mayRetry: () => boolean = () => true,
) {
  try {
    return await run();
  } catch (error) {
    signal?.throwIfAborted();
    const retryable =
      error instanceof UnusableReplyError || isMidStreamServerError(error);
    if (!retryable || !mayRetry()) throw error;
    logEvent("warn", "video.model.retry", { error: errorText(error) });
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
 * The script to film: the first draft within the word and beat limits, else
 * the first within the word limit, else the shorter draft while it stays
 * within the hard limit, with extra beats joined (fitBeats). Null when none
 * fits.
 */
export function pickScript(drafts: Array<Script | null>): Script | null {
  const counted = drafts
    .filter((draft): draft is Script => draft !== null)
    .map((draft) => ({ draft, words: scriptWordCount(draft) }));
  const fits =
    counted.find(
      ({ draft, words }) =>
        words <= SCRIPT_WORD_LIMIT && draft.beats.length <= MAX_BEATS,
    ) ?? counted.find(({ words }) => words <= SCRIPT_WORD_LIMIT);
  if (fits) return fitBeats(fits.draft);
  const shortest = counted.sort((a, b) => a.words - b.words)[0];
  return shortest && shortest.words <= SCRIPT_HARD_WORD_LIMIT
    ? fitBeats(shortest.draft)
    : null;
}

export function createFilmWriters(
  input: RepositoryContextInput,
  planner: Planner,
  options: {
    images?: FilmImage[];
    /** A different system prompt, for experiments. */
    system?: string;
  } = {},
) {
  let director: Role = { model: planner.model, effort: planner.effort };
  let designer: Role = planner.designer ?? director;
  // A separate designer stands in for a failed director by default.
  const fallback: Role | undefined =
    planner.fallback ??
    (designer.model !== director.model ? designer : undefined);
  const clients = new Map<string, Anthropic | OpenAI>();
  const clientFor = (model: string) => {
    let client = clients.get(model);
    if (!client) {
      client = isOpenAIModel(model) ? new OpenAI() : new Anthropic();
      clients.set(model, client);
    }
    return client;
  };
  let images = options.images ?? [];
  let context = repositoryContext(input, images);
  const system = options.system ?? SHOT_SYSTEM;
  const usage: ModelUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
  let directorCalls = 0;

  /**
   * One tool call with the film's current pictures. If the API refuses the
   * request over a picture, the pictures are dropped for the rest of the film
   * and the call is made once more without them, rather than failing a paid run.
   */
  async function call(
    params: Role & {
      task: string;
      tool: string;
      cache: boolean;
      signal?: AbortSignal;
    },
  ): Promise<Json> {
    const once = () => {
      const client = clientFor(params.model);
      const request = { ...params, images, context, system, usage };
      return client instanceof OpenAI
        ? callOpenAITool({ ...request, client })
        : callClaudeTool({ ...request, client });
    };
    try {
      return await once();
    } catch (error) {
      params.signal?.throwIfAborted();
      if (!images.length || !isPictureRejection(error)) throw error;
      logEvent("warn", "video.pictures.rejected", {
        model: params.model,
        error: errorText(error),
      });
      images = [];
      context = repositoryContext(input, images);
      return once();
    }
  }

  /**
   * Write the designers' shared prefix into OpenAI's cache while a different
   * model directs, so the parallel designers all read it (0.1× input) instead
   * of each writing their own (1.25×). Best effort; never rejects.
   */
  async function prewarm(signal?: AbortSignal): Promise<void> {
    const client = clientFor(designer.model);
    if (!(client instanceof OpenAI)) return;
    try {
      const response = await client.responses.create(
        openAIRequest(
          {
            ...designer,
            images,
            context,
            system,
            task: "",
            tool: SHOTS_TOOL.name,
            cache: true,
          },
          true,
        ),
        { signal },
      );
      addUsage(
        usage,
        { input: response.usage?.input_tokens ?? 0, output: 0 },
        openAICostUsd(designer.model, response),
      );
    } catch (error) {
      logEvent("warn", "video.designer.prewarm_failed", {
        error: errorText(error),
      });
    }
  }

  /** The script, written by the current director. */
  async function directWith(signal?: AbortSignal): Promise<Script> {
    // The director's cache is only worth writing when the designers will
    // read it, which means the same model designs.
    const cache = director.model === designer.model;
    const mayCall = () => directorCalls < MAX_DIRECTOR_CALLS;
    // A script too thin to film is an unusable reply like any other.
    const write = (task: string) =>
      withRetry(
        async () => {
          directorCalls += 1;
          const raw = await call({
            ...director,
            task,
            tool: SCRIPT_TOOL.name,
            cache,
            signal,
          });
          try {
            return normalizeScript(raw, input.repo, context);
          } catch (error) {
            throw new UnusableReplyError(
              error instanceof Error ? error.message : "Unusable script.",
            );
          }
        },
        signal,
        mayCall,
      );
    const script = await write(DIRECTOR_TASK);
    const words = scriptWordCount(script);
    if (words <= SCRIPT_WORD_LIMIT && script.beats.length <= MAX_BEATS)
      return script;
    // The voice runs at a natural pace, so a long script means a long film.
    // A failed shortening only leaves the first draft to be judged alone.
    let trimmed: Script | null = null;
    if (mayCall())
      try {
        trimmed = await write(
          trimTask({
            script: JSON.stringify(script),
            words,
            target: SCRIPT_WORD_TARGET,
            beats: script.beats.length,
            maxBeats: MAX_BEATS,
          }),
        );
      } catch (error) {
        signal?.throwIfAborted();
        logEvent("warn", "video.script.trim_failed", {
          error: errorText(error),
        });
      }
    const chosen = pickScript([script, trimmed]);
    logEvent("info", "video.script.trimmed", {
      from: words,
      to: trimmed ? scriptWordCount(trimmed) : null,
      chosen: chosen ? scriptWordCount(chosen) : null,
    });
    if (!chosen)
      throw new ScriptTooLongError(
        `The script stayed too long (${words} words, hard limit ${SCRIPT_HARD_WORD_LIMIT}).`,
      );
    return chosen;
  }

  return {
    /** The models making the film: "director+designer" when they differ. */
    get model() {
      return designer.model !== director.model
        ? `${director.model}+${designer.model}`
        : director.model;
    },
    /** The README pictures the writers still see (all, unless an API refused them). */
    get pictureIds() {
      return images.map((image) => image.id);
    },
    usage,
    /**
     * The script, checked and within length, before any parallel work starts.
     * When the director fails (out of credit, overloaded, an unusable reply),
     * the fallback model writes the script instead, and takes over designing
     * too if it was the director's own model, so the film is still made. A
     * refusal, a script that stays too long or the deadline ends the run.
     */
    async direct(signal?: AbortSignal): Promise<Script> {
      const warming =
        designer.model !== director.model && isOpenAIModel(designer.model)
          ? prewarm(signal)
          : null;
      try {
        return await directWith(signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (
          error instanceof VideoRefusalError ||
          error instanceof ScriptTooLongError ||
          !fallback ||
          fallback.model === director.model ||
          directorCalls >= MAX_DIRECTOR_CALLS
        )
          throw error;
        logEvent("warn", "video.director.fallback", {
          from: director.model,
          to: fallback.model,
          error: errorText(error),
        });
        if (designer.model === director.model) designer = fallback;
        director = fallback;
        return await directWith(signal);
      } finally {
        // Settled before returning, so no call outlives a failed run.
        await warming;
      }
    },

    /**
     * One designer per scene, all at once. A scene whose designer fails is
     * tried once more on another model (the director's, else the fallback);
     * a beat still without a shot is drawn as plain type. When more than a
     * third of the beats have no shot, the film is not worth storing and this
     * throws.
     */
    async design(
      script: Script,
      signal?: AbortSignal,
      onDesigned?: () => void,
    ): Promise<Map<number, Json>> {
      const scenes = designGroups(script);
      const outline = scriptForDesigners(script);
      const designed = new Map<number, Json>();
      const primary = designer;
      const second = [director, fallback].find(
        (role): role is Role => !!role && role.model !== primary.model,
      );
      const designWith = async (
        group: { scene: string; beats: number[] },
        role: Role,
        cache: boolean,
      ) => {
        const raw = await withRetry(
          () =>
            call({
              ...role,
              task: designerTask({
                script: outline,
                scenes: [group.scene],
                beats: group.beats,
              }),
              tool: SHOTS_TOOL.name,
              cache,
              signal,
            }),
          signal,
        );
        const shots = Array.isArray(raw.shots) ? raw.shots : [];
        for (const shot of shots) {
          const beat = Number((shot as Json).beat);
          if (group.beats.includes(beat)) designed.set(beat, shot as Json);
        }
      };
      // Settled, not raced: once aborted, no designer is still running (and
      // billing) when this returns.
      await Promise.allSettled(
        scenes.map(async (group) => {
          try {
            try {
              await designWith(group, primary, true);
            } catch (error) {
              signal?.throwIfAborted();
              if (!second) throw error;
              logEvent("warn", "video.designer.retry", {
                scene: group.scene,
                from: primary.model,
                to: second.model,
                error: errorText(error),
              });
              // A lone call: nothing would read a cache it wrote.
              await designWith(group, second, false);
            }
          } catch (error) {
            signal?.throwIfAborted();
            logEvent("warn", "video.designer.failed", {
              scene: group.scene,
              error: errorText(error),
            });
          } finally {
            onDesigned?.();
          }
        }),
      );
      signal?.throwIfAborted();
      const missing = script.beats.filter((_, beat) => !designed.has(beat));
      if (missing.length > script.beats.length * MAX_UNDESIGNED_SHARE)
        throw new Error(
          `The scenes could not be designed (${missing.length} of ${script.beats.length} beats have no shot).`,
        );
      return designed;
    },
  };
}
