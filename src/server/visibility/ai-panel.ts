import "server-only";

import {
  PANEL_ENGINES,
  type PanelAnswer,
  type PanelEngine,
  type PanelReport,
  type PanelView,
  type PanelWeek,
} from "~/features/admin/ai-panel";
import { errorText, logEvent } from "~/server/log";
import { upstashCommand, upstashPipeline } from "~/server/storage/upstash";
import type { AskResult } from "./ai-ask";
import { readAnswer } from "./ai-answer";
import {
  askPanelEngine,
  openRouterBalanceUsd,
  panelEngineConfigured,
  panelModels,
  usesOpenRouter,
} from "./ai-panel-ask";
import { buildPanelReport, isOurs, normalizeUrl } from "./ai-panel-gaps";
import { AI_PANEL_PROMPTS, type PanelPrompt } from "./ai-panel-prompts";

// The weekly prompt panel: about 100 questions x 4 engines, all with web
// search. Too many for one invocation (each answer takes 10-40 s), so the
// Monday cron fires every 10 minutes and each firing answers what is still
// open, keeping every answer in Redis as it lands. Once nothing is open the
// week's report is final. A hard cap stops new questions before the week's
// spend could pass it.

const PREFIX = "ai-panel:v1:";
const DAY_SECONDS = 24 * 60 * 60;
const KEEP_ANSWERS_SECONDS = 70 * DAY_SECONDS;
const KEEP_REPORT_SECONDS = 120 * DAY_SECONDS;
const KEEP_WEEK_SECONDS = 400 * DAY_SECONDS;
const LOCK_SECONDS = 290;
const MAX_STORED_TEXT = 1_500;
const MAX_STORED_URLS = 15;
const MAX_ATTEMPTS = 2;
const HISTORY_WEEKS = 12;

// The most one answer can cost, reserved before it starts. Measured on
// 2026-11-09, averages: ChatGPT $0.029, Claude $0.042, Gemini (Google
// grounding, usually two searches) $0.027, Perplexity Sonar $0.006.
const RESERVE_USD: Record<PanelEngine, number> = {
  chatgpt: 0.08,
  claude: 0.08,
  gemini: 0.05,
  perplexity: 0.015,
};

const answersKey = (week: string) => `${PREFIX}answers:${week}`;
const startedKey = (week: string) => `${PREFIX}started:${week}`;
const reportKey = (week: string) => `${PREFIX}report:${week}`;
const weekKey = (week: string) => `${PREFIX}week:${week}`;
const lockKey = (week: string) => `${PREFIX}lock:${week}`;
const field = (promptId: string, engine: PanelEngine) =>
  `${promptId}|${engine}`;

/** The Monday (UTC) of the week `ms` falls in. */
export function panelWeek(ms: number): string {
  const date = new Date(ms);
  const back = (date.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - back,
    ),
  )
    .toISOString()
    .slice(0, 10);
}

function envNumber(name: string, fallback: number) {
  const value = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * The week's spend cap in USD. Measured on 2026-11-09: ChatGPT $2.89, Claude
 * $4.25, Perplexity $0.58 per 100 answers and Gemini $0.027 an answer, so a
 * full week is about $10.40.
 */
const panelMaxUsd = () => envNumber("AI_PANEL_MAX_USD", 11);
/**
 * Gemini and Perplexity are paid from the OpenRouter balance that narrates
 * videos; below this balance they are skipped so videos keep their voice.
 */
const openRouterFloorUsd = () => envNumber("AI_PANEL_OPENROUTER_FLOOR_USD", 15);

/** One engine's answer, read for GitDiagram. */
function toPanelAnswer(
  prompt: PanelPrompt,
  engine: PanelEngine,
  result: AskResult,
  attempts: number,
): PanelAnswer {
  const reading = readAnswer(result.text, result.citations, result.sources);
  const urls = [
    ...new Set(
      result.citations
        .map(normalizeUrl)
        .filter((url): url is string => url !== null),
    ),
  ];
  return {
    promptId: prompt.id,
    engine,
    model: result.model,
    mentioned: reading.mentioned,
    position: reading.position,
    ourUrls: urls.filter(isOurs).slice(0, MAX_STORED_URLS),
    otherUrls: urls.filter((url) => !isOurs(url)).slice(0, MAX_STORED_URLS),
    inSources: reading.inSources,
    competitors: reading.tools.filter((tool) => tool !== "GitDiagram"),
    text: result.text.slice(0, MAX_STORED_TEXT),
    costUsd: Math.round(result.costUsd * 10_000) / 10_000,
    attempts,
  };
}

function failed(
  prompt: PanelPrompt,
  engine: PanelEngine,
  error: string,
  attempts: number,
): PanelAnswer {
  return {
    promptId: prompt.id,
    engine,
    model: panelModels()[engine],
    mentioned: false,
    position: null,
    ourUrls: [],
    otherUrls: [],
    inSources: false,
    competitors: [],
    text: "",
    costUsd: 0,
    error,
    attempts,
  };
}

/** Whether a stored answer still needs asking. */
function open(answer: PanelAnswer | undefined): boolean {
  return !answer || (Boolean(answer.error) && answer.attempts < MAX_ATTEMPTS);
}

type Ask = (
  engine: PanelEngine,
  prompt: string,
  signal: AbortSignal,
) => Promise<AskResult>;

/**
 * Asks the open questions, at most `concurrency` at once, until the deadline
 * or the cap. `save` is called with each answer as it lands. Prompt-major
 * order, so a run cut short has every engine on the same prompts.
 */
export async function askOpenQuestions(params: {
  stored: Map<string, PanelAnswer>;
  deadline: number;
  maxUsd: number;
  save: (answer: PanelAnswer) => Promise<void>;
  engines?: PanelEngine[];
  promptIds?: ReadonlySet<string>;
  prompts?: ReadonlyArray<PanelPrompt>;
  concurrency?: number;
  ask?: Ask;
  configured?: (engine: PanelEngine) => boolean;
  openRouterBalance?: () => Promise<number | null>;
  openRouterFloor?: number;
}): Promise<{ asked: number; spent: number }> {
  const prompts = params.prompts ?? AI_PANEL_PROMPTS;
  const ask = params.ask ?? askPanelEngine;
  const configured = params.configured ?? panelEngineConfigured;
  const engines = (params.engines ?? PANEL_ENGINES).filter(configured);
  let spent = [...params.stored.values()].reduce(
    (sum, answer) => sum + answer.costUsd,
    0,
  );
  const jobs = prompts
    .filter((prompt) => !params.promptIds || params.promptIds.has(prompt.id))
    .flatMap((prompt) => engines.map((engine) => ({ prompt, engine })))
    .filter(({ prompt, engine }) =>
      open(params.stored.get(field(prompt.id, engine))),
    );

  // Below the floor the OpenRouter engines are skipped for the week.
  let openRouterBlocked: string | null = null;
  if (jobs.some(({ engine }) => usesOpenRouter(engine))) {
    const floor = params.openRouterFloor ?? openRouterFloorUsd();
    const balance = await (params.openRouterBalance ?? openRouterBalanceUsd)();
    if (balance === null || balance < floor)
      openRouterBlocked = `Skipped: OpenRouter balance ${balance === null ? "unreadable" : `$${balance.toFixed(2)}`} is under the $${floor} floor that keeps video narration running.`;
  }

  let reserved = 0;
  let next = 0;
  let asked = 0;
  async function worker() {
    while (next < jobs.length) {
      const { prompt, engine } = jobs[next++]!;
      const attempts =
        (params.stored.get(field(prompt.id, engine))?.attempts ?? 0) + 1;
      if (openRouterBlocked && usesOpenRouter(engine)) {
        await params.save(
          failed(prompt, engine, openRouterBlocked, MAX_ATTEMPTS),
        );
        continue;
      }
      const remaining = params.deadline - Date.now();
      if (remaining < 45_000) return; // the next firing picks it up
      if (spent + reserved + RESERVE_USD[engine] > params.maxUsd) {
        await params.save(
          failed(prompt, engine, "Over the week's budget.", MAX_ATTEMPTS),
        );
        continue;
      }
      reserved += RESERVE_USD[engine];
      try {
        const result = await ask(
          engine,
          prompt.text,
          AbortSignal.timeout(remaining - 10_000),
        );
        spent += result.costUsd;
        asked += 1;
        await params.save(toPanelAnswer(prompt, engine, result, attempts));
      } catch (error) {
        await params.save(
          failed(prompt, engine, errorText(error, 160), attempts),
        );
      } finally {
        reserved -= RESERVE_USD[engine];
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, params.concurrency ?? 10) }, worker),
  );
  return { asked, spent };
}

function parse<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function readStored(week: string): Promise<Map<string, PanelAnswer>> {
  const flat =
    (await upstashCommand<string[] | null>(["HGETALL", answersKey(week)])) ??
    [];
  const stored = new Map<string, PanelAnswer>();
  for (let index = 0; index + 1 < flat.length; index += 2) {
    const answer = parse<PanelAnswer>(flat[index + 1]);
    if (answer) stored.set(flat[index]!, answer);
  }
  return stored;
}

export type PanelStepResult =
  | { skipped: "busy" | "done"; week: string }
  | {
      week: string;
      asked: number;
      open: number;
      costUsd: number;
      finished: boolean;
    };

/**
 * One firing of the weekly run. Answers what is open for this week (or, with
 * `restart`, starts the week over), then writes the report: final once
 * nothing is open.
 */
export async function runPanelStep(params: {
  deadline: number;
  now?: number;
  restart?: boolean;
  engines?: PanelEngine[];
  promptIds?: ReadonlySet<string>;
}): Promise<PanelStepResult> {
  const now = params.now ?? Date.now();
  const week = panelWeek(now);
  const claimed = await upstashCommand<string | null>([
    "SET",
    lockKey(week),
    String(now),
    "NX",
    "EX",
    LOCK_SECONDS,
  ]);
  if (claimed !== "OK") return { skipped: "busy", week };
  try {
    if (params.restart)
      await upstashCommand([
        "DEL",
        answersKey(week),
        startedKey(week),
        reportKey(week),
        weekKey(week),
      ]);
    else {
      const report = parse<PanelReport>(
        await upstashCommand<string | null>(["GET", reportKey(week)]),
      );
      if (report?.finishedAt) return { skipped: "done", week };
    }
    await upstashCommand([
      "SET",
      startedKey(week),
      new Date(now).toISOString(),
      "NX",
      "EX",
      KEEP_ANSWERS_SECONDS,
    ]);
    const stored = await readStored(week);
    const { asked } = await askOpenQuestions({
      stored,
      deadline: params.deadline,
      maxUsd: panelMaxUsd(),
      engines: params.engines,
      promptIds: params.promptIds,
      save: async (answer) => {
        stored.set(field(answer.promptId, answer.engine), answer);
        await upstashPipeline([
          [
            "HSET",
            answersKey(week),
            field(answer.promptId, answer.engine),
            JSON.stringify(answer),
          ],
          ["EXPIRE", answersKey(week), KEEP_ANSWERS_SECONDS],
        ]);
      },
    });
    const engines = PANEL_ENGINES.filter(panelEngineConfigured);
    const stillOpen = AI_PANEL_PROMPTS.flatMap((prompt) =>
      engines.map((engine) => stored.get(field(prompt.id, engine))),
    ).filter(open).length;
    const startedAt =
      (await upstashCommand<string | null>(["GET", startedKey(week)])) ??
      new Date(now).toISOString();
    const report = buildPanelReport({
      week,
      startedAt,
      finishedAt: stillOpen ? null : new Date().toISOString(),
      prompts: AI_PANEL_PROMPTS,
      answers: [...stored.values()],
    });
    const summary: PanelWeek = {
      week,
      costUsd: report.costUsd,
      engines: report.engines,
    };
    await upstashPipeline([
      [
        "SET",
        reportKey(week),
        JSON.stringify(report),
        "EX",
        KEEP_REPORT_SECONDS,
      ],
      ["SET", weekKey(week), JSON.stringify(summary), "EX", KEEP_WEEK_SECONDS],
    ]);
    logEvent("info", "ai_panel.step", {
      week,
      asked,
      open: stillOpen,
      cost_usd: report.costUsd,
      gaps: report.gaps.length,
      ...Object.fromEntries(
        PANEL_ENGINES.map((engine) => [
          engine,
          `${report.engines[engine].mentioned}/${report.engines[engine].answered}`,
        ]),
      ),
    });
    return {
      week,
      asked,
      open: stillOpen,
      costUsd: report.costUsd,
      finished: !stillOpen,
    };
  } finally {
    await upstashCommand(["DEL", lockKey(week)]).catch(() => undefined);
  }
}

/** The newest week's report (finished or still filling) and earlier weeks. */
export async function getPanelView(now = Date.now()): Promise<PanelView> {
  const weeks = Array.from({ length: HISTORY_WEEKS }, (_, index) =>
    panelWeek(now - index * 7 * DAY_SECONDS * 1000),
  );
  const results = await upstashPipeline(
    weeks.map((week) => ["GET", weekKey(week)]),
  );
  const history = results
    .map((result) => parse<PanelWeek>(result.result))
    .filter((week): week is PanelWeek => week !== null);
  const newest = history[0];
  const latest = newest
    ? parse<PanelReport>(
        await upstashCommand<string | null>(["GET", reportKey(newest.week)]),
      )
    : null;
  return { latest, history: history.slice(1) };
}
