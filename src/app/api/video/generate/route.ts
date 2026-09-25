import { randomUUID } from "node:crypto";
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
import { readAdmissionControls } from "~/server/admin/controls";
import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import { audienceBlock, audienceMessage } from "~/server/explainer/audience";
import {
  purgeVideoResponse,
  refreshVideoPages,
} from "~/server/explainer/cache";
import {
  canGenerateVideos,
  isVideoExplainerEnabled,
} from "~/server/explainer/config";
import { VideoRefusalError } from "~/server/explainer/director";
import { reportHeldBack } from "~/server/explainer/gate-notice";
import { generateExplainerVideo } from "~/server/explainer/generate";
import {
  generationLockName,
  isTrustedVideoCaller,
  isVideoAdmin,
  limitMessage,
  reserveVideoSlot,
  tryPaidVideoRun,
  tryVideoLock,
  type Reservation,
} from "~/server/explainer/limits";
import { hasNarrationCredits } from "~/server/explainer/narration";
import { storePoster } from "~/server/explainer/posters";
import { VideoInputError } from "~/server/explainer/repository";
import { readVideoArtifact } from "~/server/explainer/store";
import {
  readVisitor,
  withVisitorCookie,
  type Visitor,
} from "~/server/explainer/visitor";
import type { VideoGenerationEvent } from "~/features/explainer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A run gives up here, leaving the rest of maxDuration to report the failure,
// release its lock, and store the poster of a run that made it.
const VIDEO_DEADLINE_MS = 240_000;
// The lock and the paid-run place outlive the function if it dies.
const RUN_TTL_MS = 6 * 60_000;

const requestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
});

const UNAVAILABLE_MESSAGE =
  "Video generation is unavailable right now. Try again soon.";

function failureEvent(
  error: unknown,
  timedOut: boolean,
): Extract<VideoGenerationEvent, { status: "error" }> {
  if (error instanceof VideoInputError)
    return { status: "error", error: error.message, retryable: false };
  if (error instanceof VideoRefusalError)
    return {
      status: "error",
      error: "An explainer video can't be made for this repository.",
      retryable: false,
    };
  return {
    status: "error",
    error: timedOut
      ? "The explainer video took too long to make. Try again."
      : "The explainer video could not be generated. Try again.",
    retryable: true,
  };
}

/** Every response names the visitor, so their next request counts as them. */
export async function POST(request: Request): Promise<Response> {
  const visitor = readVisitor(request);
  return withVisitorCookie(await generate(request, visitor), visitor);
}

async function generate(request: Request, visitor: Visitor): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 1024,
    crossOriginError: "Video generation must come from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  if (!canGenerateVideos())
    return jsonErrorResponse("Explainer videos are not available.", 503);
  const { username, repo } = parsed.data;
  const repository = `${username}/${repo}`;
  const trusted = isTrustedVideoCaller(request);
  const production = process.env.NODE_ENV === "production";
  // A video, once made, is everyone's: only the operator may replace it.
  const mayReplace = isVideoAdmin(request) || !production;
  const gated = (reason: string) =>
    reportHeldBack(request, { username, repo, reason, step: "start" });
  if (!trusted) {
    // The page's first request (GET /api/video) names the browser. Without
    // that name the per-person budget cannot count this caller.
    if (visitor.fresh)
      return jsonErrorResponse("Reload the page and try again.", 400);
    // The operator sets who may start new videos, and can pause them, live
    // from /admin. By default anyone in a few places may. Unreadable
    // controls stop new videos rather than skip a pause.
    let controls;
    try {
      controls = await readAdmissionControls();
    } catch {
      return jsonErrorResponse(UNAVAILABLE_MESSAGE, 503);
    }
    if (controls.videosPaused) {
      gated("paused");
      return jsonErrorResponse(limitMessage("daily"), 503);
    }
    const blocked = audienceBlock(request, controls.videoAudience);
    if (blocked) {
      gated(blocked);
      return jsonErrorResponse(audienceMessage(blocked), 403);
    }
  }

  const alreadyMade = () =>
    jsonErrorResponse("This repository already has a video.", 409);
  if (!mayReplace && (await readVideoArtifact(username, repo)))
    return alreadyMade();

  let reservation: Reservation | null = null;
  let releaseLock: (() => Promise<void>) | null = null;
  let releaseRun: (() => Promise<void>) | null = null;
  const release = async () => {
    await releaseRun?.();
    await releaseLock?.();
  };
  // Hands back what admission took when no run starts after all.
  const turnAway = async (response: Response) => {
    if (reservation?.ok) await reservation.refund();
    await release();
    return response;
  };
  try {
    if (!trusted) {
      if (!(await hasNarrationCredits())) {
        gated("credits");
        return jsonErrorResponse(limitMessage("daily"), 503);
      }
      reservation = await reserveVideoSlot({
        visitorId: visitor.id,
        clientIp: getClientIp(request),
      });
      if (!reservation.ok) {
        gated(reservation.reason);
        return jsonErrorResponse(
          limitMessage(reservation.reason, reservation.limit),
          429,
        );
      }
    }
    if (production) {
      releaseLock = await tryVideoLock(
        generationLockName(username, repo),
        RUN_TTL_MS,
      );
      if (!releaseLock)
        return await turnAway(
          jsonErrorResponse(
            "This video is being made right now. It will be here in about a minute.",
            409,
          ),
        );
      // Checked again under the lock: a run that finished between the first
      // check and taking the lock has stored its video by now.
      if (!mayReplace && (await readVideoArtifact(username, repo)))
        return await turnAway(alreadyMade());
      releaseRun = await tryPaidVideoRun({
        operator: trusted,
        ttlMs: RUN_TTL_MS,
      });
      if (!releaseRun) {
        gated("busy");
        return await turnAway(
          jsonErrorResponse(
            "Lots of videos are being made right now. Try again in a few minutes.",
            503,
          ),
        );
      }
    }
  } catch (error) {
    // Redis holds the budget, so without it nothing new is started.
    console.error(
      JSON.stringify({
        event: "video.admission_failed",
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return turnAway(jsonErrorResponse(UNAVAILABLE_MESSAGE, 503));
  }

  const siteOrigin = new URL(request.url).origin;
  const origin = requestOrigin(request);
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  // The job id stays free of the repository's name, which may be private.
  const jobId = `video:${startedAt}:${randomUUID().slice(0, 8)}`;
  const deadline = AbortSignal.timeout(VIDEO_DEADLINE_MS);
  let outcome: "complete" | "error" = "error";
  // Reading the repository proved it public, so the feed may name it.
  let confirmedPublic = false;
  // A model has been called: from here on the run costs real money.
  let paid = false;
  let closed = false;
  let job: Promise<void> = Promise.resolve();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: VideoGenerationEvent) =>
        write(`data: ${JSON.stringify(event)}\n\n`);
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const onEvent = (event: VideoGenerationEvent) => {
        if (!confirmedPublic && event.status === "planning") {
          confirmedPublic = true;
          void emitLiveEvent({
            kind: "video.started",
            repo: repository,
            operator: trusted,
            job: { id: jobId, state: "start", label: repository },
            ...origin,
          });
        }
        send(event);
      };
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      // Generation is not tied to this connection: a finished video is stored,
      // so a viewer who leaves early still gets it on their next visit.
      job = generateExplainerVideo({
        username,
        repo,
        onEvent,
        onPaidWork: () => {
          paid = true;
        },
        signal: deadline,
      })
        .then(
          async (artifact) => {
            outcome = "complete";
            send({ status: "complete", artifact });
            clearInterval(heartbeat);
            close();
            // A replaced video's files are already gone: stop the CDN sending it.
            await purgeVideoResponse(username, repo);
            // The link-preview still, made once the viewer already has the video.
            await storePoster(artifact, siteOrigin);
          },
          async (error: unknown) => {
            console.error(
              JSON.stringify({
                event: "video.generation_failed",
                repository,
                paid,
                timedOut: deadline.aborted,
                error:
                  error instanceof Error
                    ? error.message.slice(0, 300)
                    : "unknown",
              }),
            );
            send(failureEvent(error, deadline.aborted));
            // Only a failure before any model call is refunded. After that the
            // run was paid for, and a refund would let one failing repository
            // be retried for free again and again.
            if (!paid && reservation?.ok) await reservation.refund();
          },
        )
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "video.generation_cleanup_failed",
              error:
                error instanceof Error
                  ? error.message.slice(0, 200)
                  : "unknown",
            }),
          );
        })
        .finally(async () => {
          clearInterval(heartbeat);
          close();
          // Every part of the run has settled by now, so the next run of this
          // repository cannot overlap its paid work.
          await release();
          await emitLiveEvent({
            kind: "video.finished",
            repo: confirmedPublic ? repository : "a repository",
            outcome,
            ms: Date.now() - startedAt,
            ...(confirmedPublic ? { job: { id: jobId, state: "end" } } : {}),
          });
        });
    },
    cancel() {
      closed = true;
    },
  });
  // Keep the function alive until the video and its poster are stored, then
  // point the pages that name it at the new one.
  after(async () => {
    await job;
    if (outcome === "complete") refreshVideoPages(username, repo);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
