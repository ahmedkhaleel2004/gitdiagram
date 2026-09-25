import { after } from "next/server";
import { z } from "zod";

import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { getClientIp } from "~/server/http/client-ip";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";
import { emitLiveEvent } from "~/server/admin/live-events";
import { refreshVideoPages } from "~/server/explainer/cache";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import {
  isTrustedVideoCaller,
  reserveRenderSlot,
  renderLimitMessage,
  tryVideoLock,
  type Reservation,
} from "~/server/explainer/limits";
import {
  remakePosterRemotely,
  renderMp4InSegments,
} from "~/server/explainer/segments";
import {
  hasRender,
  readVideoArtifact,
  writeRender,
} from "~/server/explainer/store";
import {
  readVisitor,
  withVisitorCookie,
  type Visitor,
} from "~/server/explainer/visitor";
import type { VideoRenderEvent } from "~/features/explainer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const requestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  // "poster" (re)makes the link-preview still; operator only.
  format: z.enum(["landscape", "vertical", "poster"]),
  // The version (createdAt) of the video the viewer has open. Optional so a
  // tab loaded before this field existed, or the operator's poster call,
  // still works.
  v: z.iso.datetime().optional(),
});

const STALE_MESSAGE =
  "This video was just updated. Reload the page to get the new one.";

/**
 * Make a video's MP4 once, then serve the stored file forever. The response is
 * a progress stream that ends with "complete" once the file is downloadable at
 * /api/video/file.
 */
export async function POST(request: Request): Promise<Response> {
  const visitor = readVisitor(request);
  return withVisitorCookie(await render(request, visitor), visitor);
}

async function render(request: Request, visitor: Visitor): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 1024,
    crossOriginError: "Video downloads must come from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  const { username, repo, format, v } = parsed.data;
  const artifact = await readVideoArtifact(username, repo);
  if (!artifact) return jsonErrorResponse("This video does not exist.", 404);
  // The viewer has an older version open: its MP4 would not match what they
  // watched, and its files are on their way out.
  if (v && v !== artifact.createdAt)
    return Response.json(
      { ok: false, error: STALE_MESSAGE, stale: true },
      { status: 409, headers: NO_STORE_RESPONSE_HEADERS },
    );
  const events = (list: VideoRenderEvent[]) =>
    new Response(list.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
  if (format === "poster") {
    if (!isTrustedVideoCaller(request))
      return jsonErrorResponse("Forbidden.", 403);
    // Rendered on a render instance, so this route never ships Chromium.
    const stored = await remakePosterRemotely(
      artifact,
      new URL(request.url).origin,
    );
    // The new poster has a new URL; point the pages that show it there.
    if (stored) refreshVideoPages(username, repo);
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
    if (process.env.NODE_ENV === "production") {
      releaseLock = await tryVideoLock(
        `render:${artifact.repository}:${artifact.createdAt}:${format}`,
        14 * 60_000,
      );
      if (!releaseLock)
        return jsonErrorResponse(
          "This MP4 is being made right now. Try again in a minute or two.",
          409,
        );
      // Another render may have stored it between the first check and the lock.
      if (await hasRender(artifact, name)) {
        await releaseLock();
        return events([{ status: "complete" }]);
      }
    }
    if (!isTrustedVideoCaller(request)) {
      reservation = await reserveRenderSlot({
        visitorId: visitor.id,
        clientIp: getClientIp(request),
      });
      if (!reservation.ok) {
        await releaseLock?.();
        return jsonErrorResponse(renderLimitMessage(reservation.reason), 429);
      }
    }
  } catch {
    if (reservation?.ok) await reservation.refund();
    await releaseLock?.();
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
      const jobId = `render:${artifact.repository}:${format}:${started}`;
      const label = `${artifact.repository} (${format} MP4)`;
      let outcome: "complete" | "error" = "error";
      void emitLiveEvent({
        kind: "render.started",
        repo: artifact.repository,
        format,
        job: { id: jobId, state: "start", label },
      });
      let last = "";
      job = renderMp4InSegments({
        artifact,
        format,
        origin,
        onProgress: ({ fraction, step }) => {
          const percent = Math.floor(fraction * 100);
          if (`${step}:${percent}` === last) return;
          last = `${step}:${percent}`;
          send({ status: "rendering", progress: percent / 100, step });
        },
      })
        .then(async (mp4) => {
          // A regenerated video replaced this one while it rendered: its
          // folder is no longer current, so the file is not kept. (If the
          // check itself fails, keeping a finished MP4 is the better bet.)
          const current = await readVideoArtifact(username, repo).catch(
            () => artifact,
          );
          if (current?.createdAt !== artifact.createdAt) {
            console.info(
              JSON.stringify({
                event: "video.render.superseded",
                repository: artifact.repository,
                format,
              }),
            );
            send({ status: "error", error: STALE_MESSAGE });
            if (reservation?.ok) await reservation.refund();
            return;
          }
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
          outcome = "complete";
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
          await emitLiveEvent({
            kind: "render.finished",
            repo: artifact.repository,
            format,
            outcome,
            ms: Date.now() - started,
            job: { id: jobId, state: "end" },
          });
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
