import "server-only";

import {
  AI_VARIANTS,
  type AiAnswer,
  type AiMode,
  type AiProvider,
  type AiVariant,
  type AiVariantStats,
  type AiVisibilityDetail,
  type AiVisibilitySummary,
} from "~/features/admin/visibility";
import { errorText, logEvent } from "~/server/log";
import { upstashCommand, upstashPipeline } from "~/server/storage/upstash";
import {
  aiVisibilityModels,
  askAssistant,
  providerConfigured,
  type AskResult,
} from "./ai-ask";
import { AI_VISIBILITY_PROMPTS, readAnswer } from "./ai-answer";

// Once a day (Vercel Cron, /api/internal/ai-visibility) the fixed questions go
// to ChatGPT's and Claude's models, each with web search and from memory, and
// the answers are read for GitDiagram. A small summary is kept for half a
// year (the trend), the answers themselves for a month.

const PREFIX = "ai-visibility:v1:";
const DAY_SECONDS = 24 * 60 * 60;
const KEEP_SUMMARY_SECONDS = 190 * DAY_SECONDS;
const KEEP_DETAIL_SECONDS = 35 * DAY_SECONDS;
const LOCK_SECONDS = 15 * 60;
const MAX_STORED_TEXT = 3_000;
const MAX_STORED_CITATIONS = 12;

// What one answer can cost at most, reserved before it starts so the run stops
// short of the cap instead of past it. Measured on 2026-09-29: a search answer
// $0.02-0.06, one from memory $0.003-0.014; a whole run about $1.00.
const RESERVE_USD: Record<AiMode, number> = { search: 0.07, memory: 0.02 };

const summaryKey = (date: string) => `${PREFIX}summary:${date}`;
const detailKey = (date: string) => `${PREFIX}detail:${date}`;
const lockKey = (date: string) => `${PREFIX}lock:${date}`;

function utcDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function maxRunUsd() {
  const value = Number.parseFloat(process.env.AI_VISIBILITY_MAX_USD ?? "");
  return Number.isFinite(value) && value > 0 ? value : 1.5;
}

function emptyStats(): AiVariantStats {
  return { asked: 0, answered: 0, mentioned: 0, cited: 0, positionSum: 0 };
}

/** The day's summary, from its answers. */
function summarize(params: {
  date: string;
  ranAt: string;
  durationMs: number;
  models: Record<AiProvider, string>;
  answers: AiAnswer[];
}): AiVisibilitySummary {
  const prompts = AI_VISIBILITY_PROMPTS.map((prompt) => prompt.id);
  const variants = Object.fromEntries(
    AI_VARIANTS.map((variant) => [variant, emptyStats()]),
  ) as Record<AiVariant, AiVariantStats>;
  const marks = Object.fromEntries(
    AI_VARIANTS.map((variant) => [variant, "-".repeat(prompts.length)]),
  ) as Record<AiVariant, string>;
  const competitors = new Map<string, number>();
  let costUsd = 0;
  for (const answer of params.answers) {
    costUsd += answer.costUsd;
    const stats = variants[answer.variant];
    stats.asked += 1;
    const index = prompts.indexOf(answer.promptId);
    let mark = "-";
    if (!answer.error) {
      stats.answered += 1;
      if (answer.mentioned) stats.mentioned += 1;
      if (answer.cited) stats.cited += 1;
      if (answer.position !== null) stats.positionSum += answer.position;
      mark = answer.cited ? "2" : answer.mentioned ? "1" : "0";
      for (const tool of answer.tools)
        if (tool !== "GitDiagram")
          competitors.set(tool, (competitors.get(tool) ?? 0) + 1);
    }
    if (index >= 0) {
      const row = marks[answer.variant];
      marks[answer.variant] = row.slice(0, index) + mark + row.slice(index + 1);
    }
  }
  return {
    date: params.date,
    ranAt: params.ranAt,
    durationMs: params.durationMs,
    costUsd: Math.round(costUsd * 10_000) / 10_000,
    models: params.models,
    prompts,
    variants,
    marks,
    competitors: [...competitors.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15),
  };
}

type Ask = (
  provider: AiProvider,
  prompt: string,
  mode: AiMode,
  signal: AbortSignal,
) => Promise<AskResult>;

/**
 * Ask every question to every configured provider and mode, at most
 * `concurrency` at once, stopping new questions at the deadline or once the
 * spend could pass the cap. Returns every answer, failures included.
 */
export async function collectAnswers(params: {
  deadline: number;
  concurrency?: number;
  maxUsd?: number;
  ask?: Ask;
  configured?: (provider: AiProvider) => boolean;
}): Promise<AiAnswer[]> {
  const ask = params.ask ?? askAssistant;
  const configured = params.configured ?? providerConfigured;
  const maxUsd = params.maxUsd ?? maxRunUsd();
  const jobs = AI_VISIBILITY_PROMPTS.flatMap((prompt) =>
    AI_VARIANTS.map((variant) => ({ prompt, variant })),
  ).filter(({ variant }) => configured(variant.split(":")[0] as AiProvider));
  const answers: AiAnswer[] = [];
  let spent = 0;
  let reserved = 0;
  let next = 0;

  async function worker() {
    while (next < jobs.length) {
      const { prompt, variant } = jobs[next++]!;
      const [provider, mode] = variant.split(":") as [AiProvider, AiMode];
      const base = {
        variant,
        promptId: prompt.id,
        prompt: prompt.text,
        mentioned: false,
        cited: false,
        inSources: false,
        position: null,
        tools: [],
        text: "",
        citations: [],
        costUsd: 0,
      } satisfies AiAnswer;
      const remaining = params.deadline - Date.now();
      if (remaining < 20_000) {
        answers.push({ ...base, error: "Out of time." });
        continue;
      }
      if (spent + reserved + RESERVE_USD[mode] > maxUsd) {
        answers.push({ ...base, error: "Over the day's budget." });
        continue;
      }
      reserved += RESERVE_USD[mode];
      try {
        const result = await ask(
          provider,
          prompt.text,
          mode,
          AbortSignal.timeout(remaining - 5_000),
        );
        spent += result.costUsd;
        answers.push({
          ...base,
          ...readAnswer(result.text, result.citations, result.sources),
          text: result.text.slice(0, MAX_STORED_TEXT),
          citations: [...new Set(result.citations)].slice(
            0,
            MAX_STORED_CITATIONS,
          ),
          costUsd: Math.round(result.costUsd * 10_000) / 10_000,
        });
      } catch (error) {
        answers.push({ ...base, error: errorText(error, 160) });
      } finally {
        reserved -= RESERVE_USD[mode];
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, params.concurrency ?? 6) }, worker),
  );
  const order = (answer: AiAnswer) =>
    AI_VISIBILITY_PROMPTS.findIndex((p) => p.id === answer.promptId) * 10 +
    AI_VARIANTS.indexOf(answer.variant);
  return answers.sort((a, b) => order(a) - order(b));
}

/**
 * Today's run: once per UTC day unless forced (a Redis lock, so a cron retry
 * does not pay twice). Returns null when today's run already started.
 */
export async function runAiVisibility(params: {
  deadline: number;
  force?: boolean;
  now?: number;
}): Promise<AiVisibilitySummary | null> {
  const startedAt = params.now ?? Date.now();
  const date = utcDate(startedAt);
  if (!params.force) {
    const claimed = await upstashCommand<string | null>([
      "SET",
      lockKey(date),
      String(startedAt),
      "NX",
      "EX",
      LOCK_SECONDS,
    ]);
    if (claimed !== "OK") return null;
  }
  const answers = await collectAnswers({ deadline: params.deadline });
  const summary = summarize({
    date,
    ranAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    models: aiVisibilityModels(),
    answers,
  });
  const detail: AiVisibilityDetail = { date, answers };
  await upstashPipeline([
    [
      "SET",
      summaryKey(date),
      JSON.stringify(summary),
      "EX",
      KEEP_SUMMARY_SECONDS,
    ],
    ["SET", detailKey(date), JSON.stringify(detail), "EX", KEEP_DETAIL_SECONDS],
  ]);
  logEvent("info", "ai_visibility.run", {
    date,
    cost_usd: summary.costUsd,
    duration_ms: summary.durationMs,
    failed: answers.filter((answer) => answer.error).length,
    ...Object.fromEntries(
      AI_VARIANTS.map((variant) => [
        variant,
        `${summary.variants[variant].mentioned}/${summary.variants[variant].answered}`,
      ]),
    ),
  });
  return summary;
}

function parse<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * The last `days` days' summaries (newest first, days without a run left out)
 * and the newest day's answers.
 */
export async function getAiVisibility(
  days: number,
  now = Date.now(),
): Promise<{
  summaries: AiVisibilitySummary[];
  latest: AiVisibilityDetail | null;
}> {
  const dates = Array.from({ length: days }, (_, index) =>
    utcDate(now - index * DAY_SECONDS * 1000),
  );
  const results = await upstashPipeline(
    dates.map((date) => ["GET", summaryKey(date)]),
  );
  const summaries = results
    .map((result) => parse<AiVisibilitySummary>(result.result))
    .filter((summary): summary is AiVisibilitySummary => summary !== null);
  const newest = summaries[0];
  const latest = newest
    ? parse<AiVisibilityDetail>(
        await upstashCommand<string | null>(["GET", detailKey(newest.date)]),
      )
    : null;
  return { summaries, latest };
}
