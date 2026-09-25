import { jsonErrorResponse } from "~/server/http/same-origin-json";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { storePoster } from "~/server/explainer/posters";
import { renderHostStats, renderVideoSegment } from "~/server/explainer/render";
import {
  encodeSegmentEvent,
  SEGMENT_BUSY_HEADER,
  segmentJobSchema,
  verifySegmentJob,
  type SegmentEvent,
} from "~/server/explainer/segments";
import { readVideoArtifact } from "~/server/explainer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Above one attempt's timeout (SEGMENT_ATTEMPT_MS), which the caller enforces.
export const maxDuration = 300;

/**
 * Chromium renders running on this instance. Fluid compute sends many
 * requests to one instance, and each render is a whole Chromium plus an
 * encoder, so past the limit the caller is told to retry: its next attempt
 * usually lands on an instance with room.
 */
let running = 0;

function renderLimit(): number {
  const configured = Number.parseInt(
    process.env.VIDEO_SEGMENT_CONCURRENCY?.trim() ?? "",
    10,
  );
  if (Number.isFinite(configured) && configured > 0) return configured;
  return process.env.NODE_ENV === "production" ? 2 : Infinity;
}

function busyResponse(): Response {
  return Response.json(
    { ok: false, error: "This render instance is busy." },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "1",
        [SEGMENT_BUSY_HEADER]: "1",
      },
    },
  );
}

/**
 * Render one ~5 s segment of a film, or (format "poster") remake a video's
 * poster. Called only by the render route, server to server, with a signature
 * over the exact job. A segment's answer streams progress as JSON lines and
 * ends with the segment itself; the render stops if the caller goes away.
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
  if (running >= renderLimit()) return busyResponse();
  running++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      running--;
    }
  };
  try {
    const artifact = await readVideoArtifact(job.username, job.repo);
    if (!artifact || artifact.createdAt !== job.v) {
      release();
      return jsonErrorResponse("This video version no longer exists.", 409);
    }
    const origin = new URL(request.url).origin;
    if (job.format === "poster") {
      try {
        return Response.json(
          { stored: await storePoster(artifact, origin) },
          { headers: { "Cache-Control": "no-store" } },
        );
      } finally {
        release();
      }
    }

    const format = job.format;
    const cancelled = new AbortController();
    const signal = AbortSignal.any([request.signal, cancelled.signal]);
    const frames = job.to - job.from;
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
            format,
            origin,
            from: job.from,
            to: job.to,
            signal,
            onReady: (sfx) => send({ type: "ready", sfx }),
            onFrame: (done) => {
              // About three updates a second is plenty for a progress bar;
              // the last frame is always reported.
              if (done - reported < 10 && done < frames) return;
              reported = done;
              send({ type: "frames", done });
            },
          });
          send({ type: "done", mp4: mp4.toString("base64") });
        } catch (error) {
          if (!signal.aborted)
            console.error(
              JSON.stringify({
                event: "video.segment.failed",
                from: job.from,
                to: job.to,
                error:
                  error instanceof Error
                    ? error.message.slice(0, 300)
                    : "unknown",
                host: await renderHostStats(),
              }),
            );
          send({ type: "error" });
        } finally {
          release();
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              // The caller cancelled the stream.
            }
          }
        }
      },
      cancel() {
        cancelled.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    release();
    throw error;
  }
}
