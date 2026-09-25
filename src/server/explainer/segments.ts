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

// An MP4 is rendered as ~10 s segments by parallel calls to the segment route,
// then joined. Those calls are server to server: each carries an HMAC of its
// exact job so the public cannot start renders through that route.
//
// The segment route answers with newline-delimited JSON, so a render can show
// frame-by-frame progress: the segments run in parallel and all finish at about
// the same moment, so counting finished segments alone left the bar at 0% for
// the whole render.

export const segmentJobSchema = z.strictObject({
  username: z.string().min(1).max(100),
  repo: z.string().min(1).max(200),
  v: z.iso.datetime(),
  format: z.enum(["landscape", "vertical"]),
  from: z.number().int().min(0),
  to: z.number().int().min(1),
  exp: z.number().int(),
});

export type SegmentJob = z.infer<typeof segmentJobSchema>;

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

async function renderRemotely(
  origin: string,
  job: SegmentJob,
  onEvent: (event: SegmentEvent) => void,
): Promise<Buffer> {
  const response = await fetch(`${origin}/api/video/render/segment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Video-Segment": sign(job),
    },
    body: JSON.stringify(job),
    signal: AbortSignal.timeout(780_000),
  });
  const failed = (why: string | number) =>
    new Error(`Segment ${job.from}-${job.to} failed (${why})`);
  if (!response.ok || !response.body) throw failed(response.status);
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
      if (event.type === "error") throw failed("render");
      onEvent(event);
      newline = buffer.indexOf("\n");
    }
  }
  throw failed("stream ended early");
}

/** Where the render is, for the viewer: the share of the work done and the step it is on. */
export type RenderProgress = {
  fraction: number;
  step: "starting" | "rendering" | "finishing";
};

/**
 * Render every segment in parallel through the segment route, mixing the
 * soundtrack alongside, then join them. Progress counts frames across all
 * segments; launching Chromium comes before it and joining after.
 */
export async function renderMp4InSegments(params: {
  artifact: VideoArtifact;
  format: RenderFormat;
  origin: string;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<Buffer> {
  const { artifact, format, origin } = params;
  const exp = Date.now() + 10 * 60_000;
  const ranges = segmentRanges(artifact);
  const total = ranges.reduce((sum, range) => sum + range.to - range.from, 0);
  const framesDone = ranges.map(() => 0);
  const report = () => {
    const done = framesDone.reduce((sum, value) => sum + value, 0);
    params.onProgress?.(
      done === 0
        ? { fraction: 0.02, step: "starting" }
        : { fraction: 0.03 + 0.9 * (done / total), step: "rendering" },
    );
  };
  report();
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
          // Awaited below; this only keeps an early failure from going unhandled.
          mix.soundtrack.catch(() => undefined);
        } else if (event.type === "frames") {
          framesDone[index] = event.done;
          report();
        }
      };
      // One retry absorbs a cold start or a transient failure.
      return renderRemotely(origin, job, onEvent).catch(() => {
        framesDone[index] = 0;
        report();
        return renderRemotely(origin, job, onEvent);
      });
    }),
  );
  params.onProgress?.({ fraction: 0.95, step: "finishing" });
  if (!mix.soundtrack)
    throw new Error("No segment reported its sound effects.");
  const mp4 = await assembleMp4({ segments, soundtrack: await mix.soundtrack });
  params.onProgress?.({ fraction: 1, step: "finishing" });
  return mp4;
}
