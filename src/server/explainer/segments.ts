import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SfxCue } from "~/features/explainer/audio-mixer";
import type { VideoArtifact } from "~/features/explainer/types";
import { readRequiredEnv } from "~/server/storage/config";
import { assembleMp4, segmentRanges, type RenderFormat } from "./render";

// An MP4 is rendered as ~10 s segments by parallel calls to the segment route,
// then joined. Those calls are server to server: each carries an HMAC of its
// exact job so the public cannot start renders through that route.

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

async function renderRemotely(
  origin: string,
  job: SegmentJob,
): Promise<{ mp4: Buffer; sfx: SfxCue[] }> {
  const response = await fetch(`${origin}/api/video/render/segment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Video-Segment": sign(job),
    },
    body: JSON.stringify(job),
    signal: AbortSignal.timeout(290_000),
  });
  if (!response.ok)
    throw new Error(
      `Segment ${job.from}-${job.to} failed (${response.status})`,
    );
  const header = response.headers.get("X-Video-Sfx") ?? "";
  const sfx = header
    ? (JSON.parse(
        Buffer.from(header, "base64url").toString("utf8"),
      ) as SfxCue[])
    : [];
  return { mp4: Buffer.from(await response.arrayBuffer()), sfx };
}

/** Render every segment in parallel through the segment route, then join them. */
export async function renderMp4InSegments(params: {
  artifact: VideoArtifact;
  format: RenderFormat;
  origin: string;
  onProgress?: (fraction: number) => void;
}): Promise<Buffer> {
  const { artifact, format, origin } = params;
  const exp = Date.now() + 10 * 60_000;
  const ranges = segmentRanges(artifact);
  let done = 0;
  const results = await Promise.all(
    ranges.map(async (range) => {
      const job: SegmentJob = {
        username: artifact.meta.owner,
        repo: artifact.meta.repo,
        v: artifact.createdAt,
        format,
        from: range.from,
        to: range.to,
        exp,
      };
      // One retry absorbs a cold start or a transient failure.
      const result = await renderRemotely(origin, job).catch(() =>
        renderRemotely(origin, job),
      );
      params.onProgress?.((++done / ranges.length) * 0.95);
      return result;
    }),
  );
  const mp4 = await assembleMp4({
    artifact,
    segments: results.map((result) => result.mp4),
    sfx: results[0]?.sfx ?? [],
    origin,
  });
  params.onProgress?.(1);
  return mp4;
}
