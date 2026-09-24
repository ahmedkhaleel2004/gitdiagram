import { after } from "next/server";
import { z } from "zod";

import { REPOSITORY_TOO_LARGE_ERROR } from "~/server/generate/github";
import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { getClientIp } from "~/server/http/client-ip";
import {
  jsonErrorResponse,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";
import {
  canMakeVideosHere,
  EARLY_ACCESS_MESSAGE,
} from "~/server/explainer/audience";
import {
  canGenerateVideos,
  isVideoExplainerEnabled,
} from "~/server/explainer/config";
import { generateExplainerVideo } from "~/server/explainer/generate";
import {
  isTrustedVideoCaller,
  isVideoAdmin,
  limitMessage,
  reserveVideoSlot,
  tryVideoLock,
  type Reservation,
} from "~/server/explainer/limits";
import { hasNarrationCredits } from "~/server/explainer/narration";
import { storePoster } from "~/server/explainer/posters";
import { VideoInputError } from "~/server/explainer/repository";
import { readVideoArtifact } from "~/server/explainer/store";
import type { VideoGenerationEvent } from "~/features/explainer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
});

function publicMessage(error: unknown): string {
  if (error instanceof VideoInputError) return error.message;
  if (error instanceof Error && error.message === REPOSITORY_TOO_LARGE_ERROR)
    return error.message;
  return "The explainer video could not be generated. Try again.";
}

export async function POST(request: Request): Promise<Response> {
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
  const trusted = isTrustedVideoCaller(request);
  const production = process.env.NODE_ENV === "production";
  // Early access: only desktops in a few places may start new videos.
  if (!trusted && !canMakeVideosHere(request))
    return jsonErrorResponse(EARLY_ACCESS_MESSAGE, 403);

  // A video, once made, is everyone's: only the operator may replace it.
  if (!isVideoAdmin(request) && production) {
    if (await readVideoArtifact(username, repo))
      return jsonErrorResponse("This repository already has a video.", 409);
  }

  let reservation: Reservation | null = null;
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    if (!trusted) {
      if (!(await hasNarrationCredits()))
        return jsonErrorResponse(limitMessage("daily"), 503);
      reservation = await reserveVideoSlot(getClientIp(request));
      if (!reservation.ok)
        return jsonErrorResponse(limitMessage(reservation.reason), 429);
    }
    if (production) {
      releaseLock = await tryVideoLock(
        `generate:${username}/${repo}`.toLowerCase(),
        6 * 60_000,
      );
      if (!releaseLock) {
        if (reservation?.ok) await reservation.refund();
        return jsonErrorResponse(
          "This video is being made right now. It will be here in about a minute.",
          409,
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
    if (reservation?.ok) await reservation.refund();
    return jsonErrorResponse(
      "Video generation is unavailable right now. Try again soon.",
      503,
    );
  }

  const origin = new URL(request.url).origin;
  const encoder = new TextEncoder();
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
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      // Generation is not tied to this connection: a finished video is stored,
      // so a viewer who leaves early still gets it on their next visit.
      job = generateExplainerVideo({ username, repo, onEvent: send })
        .then(async (artifact) => {
          send({ status: "complete", artifact });
          clearInterval(heartbeat);
          close();
          // The link-preview still, made once the viewer already has the video.
          await storePoster(artifact, origin);
        })
        .catch(async (error: unknown) => {
          console.error(
            JSON.stringify({
              event: "video.generation_failed",
              repository: `${username}/${repo}`,
              error:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "unknown",
            }),
          );
          send({ status: "error", error: publicMessage(error) });
          if (reservation?.ok) await reservation.refund();
        })
        .finally(async () => {
          clearInterval(heartbeat);
          close();
          await releaseLock?.();
        });
    },
    cancel() {
      closed = true;
    },
  });
  // Keep the function alive until the video and its poster are stored.
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
