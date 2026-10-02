import "server-only";

import { randomUUID } from "node:crypto";
import { emitLiveEvent } from "~/server/admin/live-events";
import { refundBudget } from "~/server/explainer/limits";
import { errorText, logEvent } from "~/server/log";
import { upstashCommand, upstashEval } from "~/server/storage/upstash";

// Every video run and MP4 render writes itself down here while it works, and
// crosses itself out when it ends, however it ends. A run whose process is
// killed outright (out of memory, a host that dies, a container replaced
// without warning) runs no cleanup at all: nothing refunds the visitor's place
// in the day's budget, and nothing says it happened. So a live run also beats
// (BEAT_MS), and one that has not for ORPHAN_MS is an orphan: whoever notices
// next (the routes, when someone asks about a video, and the 15-minute cron)
// gives back what it had reserved and reports it. Its lock is a lease on the
// same beat (tryVideoLock), so the repository is free again by then.
//
// The journal also keeps the pipeline's score: how many runs of each kind
// started, completed, failed and were lost each UTC day (readVideoHealth).
//
// All of it is best effort. A run never fails, waits or changes its answer
// because the journal could not be written.

const RUNS_KEY = "video:v1:runs";
const recordKey = (id: string) => `video:v1:run:${id}`;
const healthKey = (day: string) => `video:v1:health:${day}`;
/** The latest failed and lost runs, newest first, with why. */
const FAILURES_KEY = "video:v1:failures";
const FAILURES_KEPT = 50;

/** How often a live run says so. */
const BEAT_MS = 13_000;
/** A run silent for this long is gone (three missed beats). */
const ORPHAN_MS = 40_000;
/** A record outlives any run (a render has 13 minutes) by a wide margin. */
const RECORD_TTL_SECONDS = 3_600;
const HEALTH_TTL_SECONDS = 35 * 86_400;

type RunKind = "generate" | "render";
type RunOutcome = "complete" | "error";

interface RunRecord {
  kind: RunKind;
  repository: string;
  format?: string;
  startedAt: number;
  /** Budget counters to give back if the run dies (see REFUND in limits.ts). */
  refund: string[];
  /** The /admin feed's running-job id, so a lost run leaves that list. */
  jobId?: string;
}

/** Where this server runs, so each platform's runs are counted apart. */
const platform = () => (process.env.VERCEL ? "vercel" : "cloudflare");

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

async function count(kind: RunKind, what: string, now = Date.now()) {
  const key = healthKey(utcDay(now));
  await upstashEval<number>({
    script: `redis.call("HINCRBY", KEYS[1], ARGV[1], 1)
redis.call("EXPIRE", KEYS[1], ARGV[2])
return 1`,
    keys: [key],
    args: [`${platform()}:${kind}:${what}`, HEALTH_TTL_SECONDS],
  });
}

/** Remember a run that failed or was lost, for readVideoFailures. */
async function remember(failure: {
  kind: RunKind;
  repository: string;
  format?: string;
  outcome: "error" | "lost";
  error?: string;
  ms: number;
}) {
  await upstashEval<number>({
    script: `redis.call("LPUSH", KEYS[1], ARGV[1])
redis.call("LTRIM", KEYS[1], 0, tonumber(ARGV[2]) - 1)
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1`,
    keys: [FAILURES_KEY],
    args: [
      JSON.stringify({
        at: new Date().toISOString(),
        on: platform(),
        ...failure,
      }),
      FAILURES_KEPT,
      HEALTH_TTL_SECONDS,
    ],
  });
}

const quietly = (work: Promise<unknown>, event: string) =>
  work.catch((error: unknown) =>
    logEvent("warn", event, { error: errorText(error) }),
  );

export interface OpenRun {
  /** More budget counters the run took after it started (the premium place). */
  alsoRefund(keys: string[]): void;
  /** The run ended and has settled its own refunds; `error` says why it failed. */
  close(outcome: RunOutcome, error?: string): Promise<void>;
}

/**
 * Write down a run that is starting. `refund` names the budget counters it
 * reserved; they are given back only if the run is never closed.
 */
export function openRun(run: {
  kind: RunKind;
  repository: string;
  format?: string;
  refund?: string[];
  jobId?: string;
}): OpenRun {
  const id = randomUUID();
  const record: RunRecord = {
    kind: run.kind,
    repository: run.repository,
    ...(run.format ? { format: run.format } : {}),
    startedAt: Date.now(),
    refund: [...(run.refund ?? [])],
    ...(run.jobId ? { jobId: run.jobId } : {}),
  };
  const write = () =>
    upstashCommand([
      "SET",
      recordKey(id),
      JSON.stringify(record),
      "EX",
      RECORD_TTL_SECONDS,
    ]);
  const beat = () => upstashCommand(["ZADD", RUNS_KEY, Date.now(), id]);
  // In order, so the record is there before the run can look orphaned.
  let written: Promise<unknown> = quietly(
    write()
      .then(beat)
      .then(() => count(run.kind, "started")),
    "video.run.journal_failed",
  );
  const timer = setInterval(() => void beat().catch(() => undefined), BEAT_MS);
  timer.unref?.();
  let closed = false;
  return {
    alsoRefund(keys) {
      if (closed || !keys.length) return;
      record.refund.push(...keys);
      written = written.then(() =>
        quietly(write(), "video.run.journal_failed"),
      );
    },
    async close(outcome, error) {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await written;
      await quietly(
        (async () => {
          // Only the one who removes the entry counts the ending: a run the
          // reaper already took as lost is not also a failure.
          const removed = await upstashCommand<number>(["ZREM", RUNS_KEY, id]);
          await upstashCommand(["DEL", recordKey(id)]);
          if (removed !== 1) return;
          await count(run.kind, outcome);
          if (outcome === "error")
            await remember({
              kind: record.kind,
              repository: record.repository,
              ...(record.format ? { format: record.format } : {}),
              outcome,
              ...(error ? { error: error.slice(0, 300) } : {}),
              ms: Date.now() - record.startedAt,
            });
        })(),
        "video.run.journal_failed",
      );
    },
  };
}

/**
 * Settle runs that died without a word: give back the budget places they
 * held, count them as lost and say so (an error log line and the /admin
 * feed). Safe to call from anywhere, any number of times at once: each
 * orphan is taken by exactly one caller. Returns how many were settled.
 */
export async function reapOrphanedRuns(now = Date.now()): Promise<number> {
  let reaped = 0;
  try {
    const ids = await upstashCommand<string[]>([
      "ZRANGEBYSCORE",
      RUNS_KEY,
      "-inf",
      now - ORPHAN_MS,
      "LIMIT",
      0,
      20,
    ]);
    for (const id of ids ?? []) {
      if ((await upstashCommand<number>(["ZREM", RUNS_KEY, id])) !== 1)
        continue;
      const stored = await upstashCommand<string | null>([
        "GET",
        recordKey(id),
      ]);
      await upstashCommand(["DEL", recordKey(id)]);
      if (!stored) continue;
      const record = JSON.parse(stored) as RunRecord;
      if (record.refund.length) await refundBudget(record.refund);
      await count(record.kind, "lost", now);
      await remember({
        kind: record.kind,
        repository: record.repository,
        ...(record.format ? { format: record.format } : {}),
        outcome: "lost",
        ms: now - record.startedAt,
      });
      reaped++;
      logEvent("error", "video.run.lost", {
        kind: record.kind,
        repository: record.repository,
        ...(record.format ? { format: record.format } : {}),
        afterMs: now - record.startedAt,
        refunded: record.refund.length > 0,
      });
      void emitLiveEvent({
        kind: record.kind === "render" ? "render.finished" : "video.finished",
        repo: record.repository,
        ...(record.format ? { format: record.format } : {}),
        outcome: "lost",
        ms: now - record.startedAt,
        ...(record.jobId ? { job: { id: record.jobId, state: "end" } } : {}),
      });
    }
  } catch (error) {
    logEvent("warn", "video.run.reap_failed", { error: errorText(error) });
  }
  return reaped;
}

export type VideoHealth = Record<
  RunKind,
  { started: number; complete: number; error: number; lost: number }
>;

/**
 * How the pipeline did on one platform over the last `days` UTC days (today
 * included): runs started, completed, failed and lost. Started minus the
 * other three are still running, or were lost and not noticed yet.
 */
export async function readVideoHealth(
  days = 2,
  on: "cloudflare" | "vercel" = "cloudflare",
  now = Date.now(),
): Promise<VideoHealth> {
  const health: VideoHealth = {
    generate: { started: 0, complete: 0, error: 0, lost: 0 },
    render: { started: 0, complete: 0, error: 0, lost: 0 },
  };
  for (let back = 0; back < days; back++) {
    // Redis answers a hash as a flat list of names and values (Upstash's
    // REST API), or as an object (newer protocol versions).
    const stored = await upstashCommand<
      string[] | Record<string, string> | null
    >(["HGETALL", healthKey(utcDay(now - back * 86_400_000))]);
    const entries = Array.isArray(stored)
      ? stored.flatMap((name, index) =>
          index % 2 === 0 ? [[name, stored[index + 1]] as const] : [],
        )
      : Object.entries(stored ?? {});
    for (const [name, value] of entries) {
      const [where, kind, what] = name.split(":");
      if (where !== on || (kind !== "generate" && kind !== "render")) continue;
      if (what && what in health[kind])
        health[kind][what as keyof VideoHealth[RunKind]] += Number(value) || 0;
    }
  }
  return health;
}
