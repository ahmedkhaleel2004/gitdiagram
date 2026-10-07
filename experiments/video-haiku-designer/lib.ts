/**
 * Shared pieces of the Haiku-designer experiment: where things live, the
 * setups, a recorder that wraps the two model SDKs (so every call's usage is
 * seen without touching src/), and prices.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  createCostSummary,
  normalizeGenerationUsage,
} from "~/server/generate/pricing";

export const OUT = join(
  process.cwd(),
  "experiments",
  "video-haiku-designer",
  "out",
);
export const REPOS = [
  "fastapi/fastapi",
  "BurntSushi/ripgrep",
  "pmndrs/zustand",
  "excalidraw/excalidraw",
  "ainoya/cloudflare-dom-distiller",
  "s-t-e-f-a-n/BillCollector",
];
export const DIRECTOR = { model: "claude-opus-5-5", effort: "low" } as const;
export const SETUPS = {
  "sol-medium": { model: "gpt-6.1-sol", effort: "medium" },
  "haiku-low": { model: "claude-haiku-5-5", effort: "low" },
  "haiku-medium": { model: "claude-haiku-5-5", effort: "medium" },
  "haiku-high": { model: "claude-haiku-5-5", effort: "high" },
} as const;
export type SetupName = keyof typeof SETUPS;
export const SETUP_NAMES = Object.keys(SETUPS) as SetupName[];
export const RUNS = [1, 2];

export const slugOf = (repo: string) => repo.replace("/", "__").toLowerCase();
export const runDir = (repo: string, setup: string, run: number) =>
  join(OUT, "films", slugOf(repo), `${setup}-r${run}`);

/** One model call as the API billed it. */
export interface CallRecord {
  provider: "anthropic" | "openai";
  model: string;
  effort: string | null;
  phase: string;
  ms: number;
  /** Everything sent: fresh + cache writes + cache reads. */
  promptTokens: number;
  fresh: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  reasoning: number | null;
  stop: string | null;
  tool: boolean;
  error: string | null;
  costUsd: number | null;
}

interface Scope {
  calls: CallRecord[];
  phase: string;
  /** While set, the director's call is answered from this saved script. */
  replay?: unknown;
  /** The last write_script input the director sent. */
  lastScript?: unknown;
  /** Every reply's tool input (or text), for looking at unusable ones. */
  raws?: unknown[];
}
const scope = new AsyncLocalStorage<Scope>();
export const currentScope = () => scope.getStore();
export function withScope<T>(store: Scope, run: () => Promise<T>) {
  return scope.run(store, run);
}

// USD per million tokens. Haiku 5.5: the task brief's prices (2026-10-07);
// the higher band applies when the whole prompt is over 100,000 tokens.
// 1-hour cache writes are not in the brief: taken as 2x input, as for every
// other Claude model in src/server/anthropic-pricing.ts.
const HAIKU = {
  small: { input: 0.1, output: 0.5, read: 0.01, write5m: 0.125, write1h: 0.2 },
  large: { input: 0.5, output: 2.5, read: 0.05, write5m: 0.625, write1h: 1.0 },
};
const OPUS = { input: 4, output: 20, read: 0.2, write5m: 5, write1h: 8 };
export const LONG_PROMPT = 100_000;

export function claudeCost(
  model: string,
  t: Pick<
    CallRecord,
    | "promptTokens"
    | "fresh"
    | "cacheWrite5m"
    | "cacheWrite1h"
    | "cacheRead"
    | "output"
  >,
): number | null {
  const p = model.startsWith("claude-haiku-5-5")
    ? t.promptTokens > LONG_PROMPT
      ? HAIKU.large
      : HAIKU.small
    : model.startsWith("claude-opus-5-5")
      ? OPUS
      : null;
  if (!p) return null;
  return (
    (t.fresh * p.input +
      t.cacheWrite5m * p.write5m +
      t.cacheWrite1h * p.write1h +
      t.cacheRead * p.read +
      t.output * p.output) /
    1e6
  );
}

const zero = {
  promptTokens: 0,
  fresh: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
  reasoning: null,
};

let installed = false;
/** Wrap the SDK methods director.ts uses, so each call is recorded. */
export function installRecorder() {
  if (installed) return;
  installed = true;
  const messages = (Anthropic as any).Messages.prototype;
  const realStream = messages.stream;
  messages.stream = function (body: any, options: any) {
    const store = scope.getStore();
    if (store?.replay !== undefined && body.model === DIRECTOR.model) {
      const input = store.replay;
      return {
        finalMessage: async () => ({
          stop_reason: "tool_use",
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [
            { type: "tool_use", id: "replay", name: "write_script", input },
          ],
        }),
      };
    }
    const started = Date.now();
    const stream = realStream.call(this, body, options);
    if (!store) return stream;
    const base = {
      provider: "anthropic" as const,
      model: body.model as string,
      effort: (body.output_config?.effort as string) ?? null,
      phase: store.phase,
    };
    const realFinal = stream.finalMessage.bind(stream);
    stream.finalMessage = async () => {
      try {
        const m = await realFinal();
        const u = m.usage;
        const write = u.cache_creation_input_tokens ?? 0;
        const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        const read = u.cache_read_input_tokens ?? 0;
        const tokens = {
          promptTokens: u.input_tokens + write + read,
          fresh: u.input_tokens,
          cacheWrite5m: write - write1h,
          cacheWrite1h: write1h,
          cacheRead: read,
          output: u.output_tokens,
          reasoning: null,
        };
        const call = m.content.find((b: any) => b.type === "tool_use");
        if (call?.name === "write_script") store.lastScript = call.input;
        store.raws?.push({
          model: base.model,
          stop: m.stop_reason,
          task: String(body.messages?.[0]?.content?.at?.(-1)?.text ?? "").slice(
            -300,
          ),
          content: m.content.filter((b: any) => b.type !== "thinking"),
        });
        store.calls.push({
          ...base,
          ...tokens,
          ms: Date.now() - started,
          stop: m.stop_reason,
          tool: Boolean(call),
          error: null,
          costUsd: claudeCost(base.model, tokens),
        });
        return m;
      } catch (error) {
        store.calls.push({
          ...base,
          ...zero,
          ms: Date.now() - started,
          stop: null,
          tool: false,
          error: String((error as Error)?.message ?? error).slice(0, 300),
          costUsd: 0,
        });
        throw error;
      }
    };
    return stream;
  };

  const responses = (OpenAI as any).Responses.prototype;
  const realCreate = responses.create;
  responses.create = function (body: any, options: any) {
    const store = scope.getStore();
    const started = Date.now();
    const promise = realCreate.call(this, body, options);
    if (!store) return promise;
    const base = {
      provider: "openai" as const,
      model: body.model as string,
      effort: (body.reasoning?.effort as string) ?? null,
      phase: body.prompt_cache_options?.prewarm ? "prewarm" : store.phase,
    };
    return (promise as Promise<any>).then(
      (r) => {
        const u = r.usage ?? {};
        const read = u.input_tokens_details?.cached_tokens ?? 0;
        const write = u.input_tokens_details?.cache_write_tokens ?? 0;
        const usage = normalizeGenerationUsage(u, r.service_tier);
        let costUsd: number | null = null;
        try {
          costUsd = usage
            ? createCostSummary({
                kind: "actual",
                model: base.model,
                approximate: false,
                usage,
              }).amountUsd
            : null;
        } catch {
          costUsd = null;
        }
        store.raws?.push({
          model: base.model,
          stop: r.status,
          task: String(body.input?.at?.(-1)?.content?.[0]?.text ?? "").slice(
            -300,
          ),
          output: (r.output ?? []).filter((i: any) => i.type !== "reasoning"),
        });
        store.calls.push({
          ...base,
          promptTokens: u.input_tokens ?? 0,
          fresh: (u.input_tokens ?? 0) - read - write,
          cacheWrite5m: write,
          cacheWrite1h: 0,
          cacheRead: read,
          output: u.output_tokens ?? 0,
          reasoning: u.output_tokens_details?.reasoning_tokens ?? null,
          ms: Date.now() - started,
          stop:
            r.status === "completed"
              ? "completed"
              : `${r.status}:${r.incomplete_details?.reason ?? ""}`,
          tool: (r.output ?? []).some((i: any) => i.type === "function_call"),
          error: null,
          costUsd,
        });
        return r;
      },
      (error: unknown) => {
        store.calls.push({
          ...base,
          ...zero,
          ms: Date.now() - started,
          stop: null,
          tool: false,
          error: String((error as Error)?.message ?? error).slice(0, 300),
          costUsd: 0,
        });
        throw error;
      },
    );
  };
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
