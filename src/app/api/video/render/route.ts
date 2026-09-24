import { after } from "next/server";
import { z } from "zod";

import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { getClientIp } from "~/server/http/client-ip";
import {
  jsonErrorResponse,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import {
  isTrustedVideoCaller,
  reserveRenderSlot,
  tryVideoLock,
  type Reservation,
} from "~/server/explainer/limits";
import { storePoster } from "~/server/explainer/posters";
import { renderMp4InSegments } from "~/server/explainer/segments";
import {
  hasRender,
  readVideoArtifact,
  writeRender,
} from "~/server/explainer/store";
import type { VideoRenderEvent } from "~/features/explainer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const requestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  // "poster" (re)makes the link-preview still; operator only.
  format: z.enum(["landscape", "vertical", "poster"]),
});

/**
 * Make a video's MP4 once, then serve the stored file forever. The response is
 * a progress stream that ends with "complete" once the file is downloadable at
 * /api/video/file.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 1024,
    crossOriginError: "Video downloads must come from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  const { username, repo, format } = parsed.data;
  const artifact = await readVideoArtifact(username, repo);
  if (!artifact) return jsonErrorResponse("This video does not exist.", 404);
  const events = (list: VideoRenderEvent[]) =>
    new Response(list.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
  if (format === "poster") {
    if (!isTrustedVideoCaller(request))
      return jsonErrorResponse("Forbidden.", 403);
    const stored = await storePoster(artifact, new URL(request.url).origin);
    return events([
      stored
        ? { status: "complete" }
        : { status: "error", error: "The poster could not be rendered." },
    ]);
  }
  const name = format === "vertical" ? "vertical.mp4" : "landscape.mp4";
  if (await hasRender(artifact, name)) return events([{ status: "complete" }]);

  let reservation: Reservation | null = null;
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    if (!isTrustedVideoCaller(request)) {
      reservation = await reserveRenderSlot(getClientIp(request));
      if (!reservation.ok)
        return jsonErrorResponse(
          "Too many downloads from this network today. Try again tomorrow.",
          429,
        );
    }
    if (process.env.NODE_ENV === "production") {
      releaseLock = await tryVideoLock(
        `render:${artifact.repository}:${artifact.createdAt}:${format}`,
        14 * 60_000,
      );
      if (!releaseLock) {
        if (reservation?.ok) await reservation.refund();
        return jsonErrorResponse(
          "This MP4 is being made right now. Try again in a minute or two.",
          409,
        );
      }
    }
  } catch {
    if (reservation?.ok) await reservation.refund();
    return jsonErrorResponse(
      "Downloads are unavailable right now. Try again soon.",
      503,
    );
  }

  const origin = new URL(request.url).origin;
  const encoder = new TextEncoder();
  let closed = false;
  let job: Promise<void> = Promise.resolve();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: VideoRenderEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const started = Date.now();
      let last = -1;
      job = renderMp4InSegments({
        artifact,
        format,
        origin,
        onProgress: (fraction) => {
          const percent = Math.floor(fraction * 100);
          if (percent === last) return;
          last = percent;
          send({ status: "rendering", progress: percent / 100 });
        },
      })
        .then(async (mp4) => {
          await writeRender(artifact, name, mp4);
          console.info(
            JSON.stringify({
              event: "video.render.stored",
              repository: artifact.repository,
              format,
              bytes: mp4.byteLength,
              ms: Date.now() - started,
            }),
          );
          send({ status: "complete" });
        })
        .catch(async (error: unknown) => {
          console.error(
            JSON.stringify({
              event: "video.render.failed",
              repository: artifact.repository,
              format,
              error:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "unknown",
            }),
          );
          send({
            status: "error",
            error: "The MP4 could not be made. Try again.",
          });
          if (reservation?.ok) await reservation.refund();
        })
        .finally(async () => {
          if (!closed) {
            closed = true;
            controller.close();
          }
          await releaseLock?.();
        });
    },
    cancel() {
      closed = true;
    },
  });
  // A render finishes and is stored even if the viewer leaves.
  after(() => job);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
