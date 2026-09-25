import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SfxCue } from "~/features/explainer/audio-mixer";
import type { VideoArtifact } from "~/features/explainer/types";
import { readIntEnv } from "~/server/env";
import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { logEvent } from "~/server/log";
import { readRequiredEnv } from "~/server/storage/config";
import {
  assembleMp4,
  mixSoundtrack,
  segmentRanges,
  untilAborted,
  type RenderFormat,
} from "./ffmpeg";
import { deploymentHeaders } from "./render-origin";

// An MP4 is rendered as ~5 s segments by parallel calls to the segment route,
// then joined. Those calls are server to server: each carries an HMAC of its
// exact job so the public cannot start renders through that route. The same
// route remakes a video's poster for the operator, so only the routes that
// launch Chromium ship it.
//
// The segment route answers with newline-delimited JSON, so a render can show
// frame-by-frame progress: the segments run in parallel and all finish at about
// the same moment, so counting finished segments alone left the bar at 0% for
// the whole render.
//
// Every call goes to the deployment that started the render (see
// render-origin.ts), so a deploy mid-render cannot mix two engines in one
// film or store it under the wrong engine version.

export const segmentJobSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  v: z.iso.datetime(),
  format: z.enum(["landscape", "vertical", "poster"]),
  from: z.number().int().min(0),
  to: z.number().int().min(1),
  exp: z.number().int(),
});

export type SegmentJob = z.infer<typeof segmentJobSchema>;

// The render route runs for at most 800 s. The whole render (segments, the
// soundtrack, joining and storing) has one deadline inside that; segments get
// a shorter one, leaving time to join the film and store it, and their
// signatures stay valid until then, so a retry late in a render still passes.
/** How long a whole render has, from the first segment to the stored file. */
export const RENDER_TOTAL_DEADLINE_MS = 780_000;
/** How long every segment of a render has, retries included. */
export const RENDER_DEADLINE_MS = 700_000;
/** One attempt at one segment; a 5 s segment normally takes well under a minute. */
const SEGMENT_ATTEMPT_MS = 240_000;
/** Attempts per segment that fail for real (an instance that is only busy is not one). */
const SEGMENT_ATTEMPTS = 3;
/** Below this, a new attempt could not finish before the deadline. */
const MIN_ATTEMPT_MS = 20_000;
/** Longest wait a Retry-After may ask for between two attempts. */
const MAX_RETRY_AFTER_MS = 15_000;
/**
 * Segment requests one render keeps in flight. Each render instance takes
 * only a couple (VIDEO_SEGMENT_CONCURRENCY), so posting every segment of a
 * long film at once only piled up busy answers and retries.
 */
const segmentFanOut = () => readIntEnv("VIDEO_SEGMENT_FAN_OUT", 10, { min: 1 });

/** The segment route's header on a 503 that means "this instance is busy, try another". */
export const SEGMENT_BUSY_HEADER = "X-Video-Segment-Busy";

/**
 * The key segment jobs are signed with: derived from CACHE_KEY_SECRET for
 * this use alone. The private cache namespace is an HMAC of user-supplied
 * text under CACHE_KEY_SECRET itself, so signing with that secret directly
 * would let a crafted token's namespace double as a valid job signature.
 */
const signingKey = () =>
  createHmac("sha256", readRequiredEnv("CACHE_KEY_SECRET"))
    .update("video-segment-key/v1")
    .digest();

function sign(job: SegmentJob): string {
  // A JSON array has one encoding per job; no field can run into the next.
  const payload = JSON.stringify([
    job.username.toLowerCase(),
    job.repo.toLowerCase(),
    job.v,
    job.format,
    job.from,
    job.to,
    job.exp,
  ]);
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

export function verifySegmentJob(job: SegmentJob, signature: string): boolean {
  if (job.exp < Date.now() || job.to <= job.from) return false;
  const expected = Buffer.from(sign(job));
  const presented = Buffer.from(signature);
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

export type SegmentEvent =
  | { type: "ready"; sfx: SfxCue[] }
  | { type: "frames"; done: number }
  | { type: "done"; mp4: string }
  | { type: "error" };

export function encodeSegmentEvent(event: SegmentEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * A failed attempt and whether another could work: "busy" (the instance was
 * full, or the platform asked us to slow down; free to retry), "retry" (a
 * network error, a timeout, a 5xx, a crash mid-render), "stale" (the video
 * was replaced while it rendered) or "final" (a forbidden job, or the render
 * was called off).
 */
export class SegmentFailure extends Error {
  constructor(
    message: string,
    readonly kind: "busy" | "retry" | "stale" | "final",
    /** How long the server asked us to wait before trying again. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Whether a render failed because its video was replaced meanwhile. */
export function isStaleRender(error: unknown): boolean {
  return error instanceof SegmentFailure && error.kind === "stale";
}

function postJob(
  origin: string,
  job: SegmentJob,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${origin}/api/video/render/segment`, {
    method: "POST",
    headers: {
      ...deploymentHeaders(),
      "Content-Type": "application/json",
      "X-Video-Segment": sign(job),
    },
    body: JSON.stringify(job),
    signal,
  });
}

/** A Retry-After header (seconds or an HTTP date) in milliseconds, capped. */
function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return undefined;
  const ms = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(ms)
    ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms))
    : undefined;
}

function failureFor(response: Response, what: string): SegmentFailure {
  const { status } = response;
  // 429: the platform is rate-limiting us, which is no fault of the job.
  const busy =
    (status === 503 && response.headers.has(SEGMENT_BUSY_HEADER)) ||
    status === 429;
  const kind = busy
    ? "busy"
    : status === 409
      ? "stale"
      : status >= 500 || status === 408
        ? "retry"
        : "final";
  return new SegmentFailure(
    `${what} failed (${status})`,
    kind,
    kind === "busy" || kind === "retry" ? retryAfterMs(response) : undefined,
  );
}

async function renderRemotely(
  origin: string,
  job: SegmentJob,
  onEvent: (event: SegmentEvent) => void,
  signal: AbortSignal,
): Promise<Buffer> {
  const what = `Segment ${job.from}-${job.to}`;
  const response = await postJob(origin, job, signal);
  if (!response.ok || !response.body) throw failureFor(response, what);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // The last line is a whole segment as base64 (megabytes, in many
    // chunks), so only the new text is searched for its end.
    let newline = value.indexOf("\n");
    if (newline !== -1) newline += buffer.length;
    buffer += value;
    while (newline !== -1) {
      const event = JSON.parse(buffer.slice(0, newline)) as SegmentEvent;
      buffer = buffer.slice(newline + 1);
      if (event.type === "done") return Buffer.from(event.mp4, "base64");
      if (event.type === "error")
        throw new SegmentFailure(`${what} failed (render)`, "retry");
      onEvent(event);
      newline = buffer.indexOf("\n");
    }
  }
  throw new SegmentFailure(`${what} failed (stream ended early)`, "retry");
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      if (signal.aborted) reject(signal.reason as Error);
      else resolve();
    }
    signal.addEventListener("abort", done);
  });

/**
 * Run `attempt` until it works, the failure is final, real failures use up
 * their budget, or the deadline leaves no room for another try. A busy
 * instance costs nothing but a short, jittered wait (or as long as the server
 * asked, within reason). Each attempt gets its own timeout, and `signal`
 * calls the whole thing off.
 */
export async function withSegmentRetries<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  options: {
    deadline: number;
    signal: AbortSignal;
    attempts?: number;
    /** Called for each failed attempt that will be tried again. */
    onRetry?: (kind: "busy" | "retry") => void;
  },
): Promise<T> {
  const { deadline, signal } = options;
  let failures = 0;
  let busy = 0;
  for (;;) {
    signal.throwIfAborted();
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS)
      throw new SegmentFailure("The render ran out of time.", "final");
    const timeout = AbortSignal.timeout(Math.min(SEGMENT_ATTEMPT_MS, left));
    try {
      return await attempt(AbortSignal.any([signal, timeout]));
    } catch (error) {
      if (signal.aborted) throw error;
      // A timed-out attempt or a dropped connection is worth another try.
      const kind = error instanceof SegmentFailure ? error.kind : "retry";
      if (kind === "final" || kind === "stale") throw error;
      if (
        kind === "retry" &&
        ++failures >= (options.attempts ?? SEGMENT_ATTEMPTS)
      )
        throw error;
      options.onRetry?.(kind);
      const backoff =
        kind === "busy"
          ? Math.min(4_000, 500 * 2 ** Math.min(busy++, 3))
          : 1_000 * failures;
      const asked =
        error instanceof SegmentFailure ? (error.retryAfterMs ?? 0) : 0;
      await pause(
        Math.max(backoff * (0.75 + Math.random() / 2), asked),
        signal,
      );
    }
  }
}

/**
 * Run `task` over `items` with at most `limit` running at once; the results
 * keep the items' order. After a task fails no new one starts.
 */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index]!, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** Where the render is, for the viewer: the share of the work done and the step it is on. */
export type RenderProgress = {
  fraction: number;
  step: "starting" | "rendering" | "finishing";
};

/**
 * Render every segment through the segment route (a bounded number at once),
 * mixing the soundtrack alongside, then join them. Progress counts frames
 * across all segments and never moves backwards; launching Chromium comes
 * before it and joining after. The first segment to fail for good stops all
 * the others, and aborting `signal` (the render's deadline) stops every step:
 * segment requests, the soundtrack's fetches and ffmpeg, and the join.
 */
export async function renderMp4InSegments(params: {
  artifact: VideoArtifact;
  format: RenderFormat;
  origin: string;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  /** The first segment request is about to go out: compute is being spent. */
  onStarted?: () => void;
}): Promise<Buffer> {
  const { artifact, format, origin } = params;
  const started = Date.now();
  const deadline = started + RENDER_DEADLINE_MS;
  // Valid for every attempt the deadline allows (none outlasts it).
  const exp = deadline + 60_000;
  const ranges = segmentRanges(artifact);
  const total = ranges.reduce((sum, range) => sum + range.to - range.from, 0);
  // The most frames each segment has reported, across its attempts: a retry
  // starts over, but the bar holds its place until it catches up.
  const framesDone = ranges.map(() => 0);
  let shown = 0;
  const report = () => {
    const done = framesDone.reduce((sum, value) => sum + value, 0);
    const fraction = done === 0 ? 0.02 : 0.03 + 0.9 * (done / total);
    if (fraction < shown) return;
    shown = fraction;
    params.onProgress?.({
      fraction,
      step: done === 0 ? "starting" : "rendering",
    });
  };
  report();
  const stop = new AbortController();
  const signal = params.signal
    ? AbortSignal.any([params.signal, stop.signal])
    : stop.signal;
  const retries = { busy: 0, retry: 0 };
  const mix: { soundtrack?: Promise<Buffer> } = {};
  let posted = false;
  try {
    const segments = await mapLimited(
      ranges,
      segmentFanOut(),
      async (range, index) => {
        const job: SegmentJob = {
          username: artifact.meta.owner,
          repo: artifact.meta.repo,
          v: artifact.createdAt,
          format,
          from: range.from,
          to: range.to,
          exp,
        };
        const onEvent = (event: SegmentEvent) => {
          if (event.type === "ready") {
            mix.soundtrack ??= mixSoundtrack({
              artifact,
              sfx: event.sfx,
              origin,
              signal,
            });
            // Awaited below; a failed mix stops the segments rather than
            // going unhandled until they finish.
            mix.soundtrack.catch((error: unknown) => stop.abort(error));
          } else if (
            event.type === "frames" &&
            event.done > framesDone[index]!
          ) {
            framesDone[index] = event.done;
            report();
          }
        };
        try {
          if (!posted) {
            posted = true;
            params.onStarted?.();
          }
          const mp4 = await withSegmentRetries(
            (attempt) => renderRemotely(origin, job, onEvent, attempt),
            {
              deadline,
              signal,
              onRetry: (kind) => retries[kind]++,
            },
          );
          framesDone[index] = range.to - range.from;
          report();
          return mp4;
        } catch (error) {
          stop.abort(error);
          throw error;
        }
      },
    );
    params.onProgress?.({ fraction: 0.95, step: "finishing" });
    if (!mix.soundtrack)
      throw new Error("No segment reported its sound effects.");
    const soundtrack = await untilAborted(mix.soundtrack, signal);
    const mp4 = await assembleMp4({ segments, soundtrack, signal });
    params.onProgress?.({ fraction: 1, step: "finishing" });
    return mp4;
  } finally {
    // Whatever ended the render, nothing it started keeps running.
    if (!stop.signal.aborted) stop.abort(new Error("The render has ended."));
    logEvent("info", "video.render.segments", {
      repository: artifact.repository,
      format,
      segments: ranges.length,
      busyRetries: retries.busy,
      failedAttempts: retries.retry,
      ms: Date.now() - started,
    });
  }
}

/**
 * Remake a video's poster and gallery still on a render instance, through the
 * segment route; resolves whether they were stored. `timeoutMs` (default two
 * minutes) bounds the wait, retries included.
 */
export async function remakePosterRemotely(
  artifact: VideoArtifact,
  origin: string,
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const job: SegmentJob = {
    username: artifact.meta.owner,
    repo: artifact.meta.repo,
    v: artifact.createdAt,
    format: "poster",
    from: 0,
    to: 1,
    exp: deadline + 60_000,
  };
  try {
    return await withSegmentRetries(
      async (signal) => {
        const response = await postJob(origin, job, signal);
        if (!response.ok) throw failureFor(response, "Poster");
        const body = (await response.json()) as { stored?: boolean };
        return body.stored === true;
      },
      // A poster render retries itself once already.
      { deadline, signal: new AbortController().signal, attempts: 1 },
    );
  } catch {
    return false;
  }
}
