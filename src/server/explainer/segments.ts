import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SfxCue } from "~/features/explainer/audio-mixer";
import type { VideoArtifact } from "~/features/explainer/types";
import { readRequiredEnv } from "~/server/storage/config";
import {
  assembleMp4,
  mixSoundtrack,
  segmentRanges,
  type RenderFormat,
} from "./render";

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

export const segmentJobSchema = z.strictObject({
  username: z.string().min(1).max(100),
  repo: z.string().min(1).max(200),
  v: z.iso.datetime(),
  format: z.enum(["landscape", "vertical", "poster"]),
  from: z.number().int().min(0),
  to: z.number().int().min(1),
  exp: z.number().int(),
});

export type SegmentJob = z.infer<typeof segmentJobSchema>;

// The render route runs for at most 800 s. Segments get one shared deadline
// inside that, leaving time to join the film and store it, and their
// signatures stay valid until then, so a retry late in a render still passes.
/** How long every segment of a render has, retries included. */
export const RENDER_DEADLINE_MS = 700_000;
/** One attempt at one segment; a 5 s segment normally takes well under a minute. */
export const SEGMENT_ATTEMPT_MS = 240_000;
/** Attempts per segment that fail for real (an instance that is only busy is not one). */
const SEGMENT_ATTEMPTS = 3;
/** Below this, a new attempt could not finish before the deadline. */
const MIN_ATTEMPT_MS = 20_000;

/** The segment route's header on a 503 that means "this instance is busy, try another". */
export const SEGMENT_BUSY_HEADER = "X-Video-Segment-Busy";

function sign(job: SegmentJob): string {
  const payload = [
    job.username.toLowerCase(),
    job.repo.toLowerCase(),
    job.v,
    job.format,
    job.from,
    job.to,
    job.exp,
  ].join("|");
  return createHmac("sha256", readRequiredEnv("CACHE_KEY_SECRET"))
    .update(`video-segment:${payload}`)
    .digest("hex");
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
 * full; free to retry), "retry" (a network error, a 5xx, a crash mid-render)
 * or "final" (a forbidden or stale job, or the render was called off).
 */
export class SegmentFailure extends Error {
  constructor(
    message: string,
    readonly kind: "busy" | "retry" | "final",
  ) {
    super(message);
  }
}

function postJob(
  origin: string,
  job: SegmentJob,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${origin}/api/video/render/segment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Video-Segment": sign(job),
    },
    body: JSON.stringify(job),
    signal,
  });
}

function failureFor(response: Response, what: string): SegmentFailure {
  const busy =
    response.status === 503 && response.headers.has(SEGMENT_BUSY_HEADER);
  return new SegmentFailure(
    `${what} failed (${response.status})`,
    busy ? "busy" : response.status >= 500 ? "retry" : "final",
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
    buffer += value;
    let newline = buffer.indexOf("\n");
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
 * instance costs nothing but a short, jittered wait. Each attempt gets its
 * own timeout, and `signal` calls the whole thing off.
 */
export async function withSegmentRetries<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  options: { deadline: number; signal: AbortSignal; attempts?: number },
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
      if (kind === "final") throw error;
      if (
        kind === "retry" &&
        ++failures >= (options.attempts ?? SEGMENT_ATTEMPTS)
      )
        throw error;
      const wait =
        kind === "busy"
          ? Math.min(4_000, 500 * 2 ** Math.min(busy++, 3))
          : 1_000 * failures;
      await pause(wait * (0.75 + Math.random() / 2), signal);
    }
  }
}

/** Where the render is, for the viewer: the share of the work done and the step it is on. */
export type RenderProgress = {
  fraction: number;
  step: "starting" | "rendering" | "finishing";
};

/**
 * Render every segment in parallel through the segment route, mixing the
 * soundtrack alongside, then join them. Progress counts frames across all
 * segments and never moves backwards; launching Chromium comes before it and
 * joining after. The first segment to fail for good stops all the others.
 */
export async function renderMp4InSegments(params: {
  artifact: VideoArtifact;
  format: RenderFormat;
  origin: string;
  onProgress?: (progress: RenderProgress) => void;
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
  const mix: { soundtrack?: Promise<Buffer> } = {};
  const segments = await Promise.all(
    ranges.map(async (range, index) => {
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
          });
          // Awaited below; a failed mix stops the segments rather than going
          // unhandled until they finish.
          mix.soundtrack.catch((error: unknown) => stop.abort(error));
        } else if (event.type === "frames" && event.done > framesDone[index]!) {
          framesDone[index] = event.done;
          report();
        }
      };
      try {
        const mp4 = await withSegmentRetries(
          (signal) => renderRemotely(origin, job, onEvent, signal),
          { deadline, signal: stop.signal },
        );
        framesDone[index] = range.to - range.from;
        report();
        return mp4;
      } catch (error) {
        stop.abort(error);
        throw error;
      }
    }),
  );
  params.onProgress?.({ fraction: 0.95, step: "finishing" });
  if (!mix.soundtrack)
    throw new Error("No segment reported its sound effects.");
  const mp4 = await assembleMp4({ segments, soundtrack: await mix.soundtrack });
  params.onProgress?.({ fraction: 1, step: "finishing" });
  return mp4;
}

/**
 * Remake a video's poster and gallery still on a render instance, through the
 * segment route; resolves whether they were stored.
 */
export async function remakePosterRemotely(
  artifact: VideoArtifact,
  origin: string,
): Promise<boolean> {
  const deadline = Date.now() + 120_000;
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
