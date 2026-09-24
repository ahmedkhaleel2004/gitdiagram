import { jsonErrorResponse } from "~/server/http/same-origin-json";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { renderVideoSegment } from "~/server/explainer/render";
import {
  segmentJobSchema,
  verifySegmentJob,
} from "~/server/explainer/segments";
import { readVideoArtifact } from "~/server/explainer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Render one ~10 s segment of a film. Called only by the render route, server
 * to server, with a signature over the exact job.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonErrorResponse("Invalid segment request.", 400);
  }
  const parsed = segmentJobSchema.safeParse(body);
  if (
    !parsed.success ||
    !verifySegmentJob(parsed.data, request.headers.get("X-Video-Segment") ?? "")
  )
    return jsonErrorResponse("Forbidden.", 403);
  const job = parsed.data;
  const artifact = await readVideoArtifact(job.username, job.repo);
  if (!artifact || artifact.createdAt !== job.v)
    return jsonErrorResponse("This video version no longer exists.", 409);
  const { mp4, sfx } = await renderVideoSegment({
    artifact,
    format: job.format,
    origin: new URL(request.url).origin,
    from: job.from,
    to: job.to,
  });
  return new Response(new Uint8Array(mp4), {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "X-Video-Sfx": Buffer.from(JSON.stringify(sfx)).toString("base64url"),
    },
  });
}
