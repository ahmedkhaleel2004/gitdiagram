import { jsonErrorResponse } from "~/server/http/same-origin-json";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { renderVideoSegment } from "~/server/explainer/render";
import {
  encodeSegmentEvent,
  segmentJobSchema,
  verifySegmentJob,
  type SegmentEvent,
} from "~/server/explainer/segments";
import { readVideoArtifact } from "~/server/explainer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Render one ~5 s segment of a film. Called only by the render route, server
 * to server, with a signature over the exact job. The answer streams progress
 * as JSON lines and ends with the segment itself.
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
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: SegmentEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeSegmentEvent(event)));
        } catch {
          open = false;
        }
      };
      let reported = 0;
      try {
        const { mp4 } = await renderVideoSegment({
          artifact,
          format: job.format,
          origin: new URL(request.url).origin,
          from: job.from,
          to: job.to,
          onReady: (sfx) => send({ type: "ready", sfx }),
          onFrame: (done) => {
            // About three updates a second is plenty for a progress bar.
            if (done - reported < 10) return;
            reported = done;
            send({ type: "frames", done });
          },
        });
        send({ type: "done", mp4: mp4.toString("base64") });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "video.segment.failed",
            from: job.from,
            to: job.to,
            error:
              error instanceof Error ? error.message.slice(0, 300) : "unknown",
          }),
        );
        send({ type: "error" });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
