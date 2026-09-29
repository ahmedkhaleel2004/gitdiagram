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
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";
import { readAdmissionControls } from "~/server/admin/controls";
import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import {
  audienceBlock,
  audienceMessage,
  isInVideoRegion,
  limitedCountryRule,
} from "~/server/explainer/audience";
import { refreshVideoPages } from "~/server/explainer/cache";
import {
  canGenerateVideos,
  isVideoExplainerEnabled,
} from "~/server/explainer/config";
import { VideoRefusalError } from "~/server/explainer/director";
import { reportHeldBack } from "~/server/explainer/gate-notice";
import { generateExplainerVideo } from "~/server/explainer/generate";
import {
  attemptLimitMessage,
  generationLockName,
  isTrustedVideoCaller,
  limitMessage,
  pausedMessage,
  reserveVideoSlot,
  takePremiumVideo,
  takeVideoAttempt,
  tryPaidVideoRun,
  tryVideoLock,
  type Reservation,
} from "~/server/explainer/limits";
import { isNarrationAvailable } from "~/server/explainer/narration";
import {
  claimVideoPayment,
  PAID_SESSION,
  type ClaimedPayment,
} from "~/server/explainer/payments";
import { choosePlanner } from "~/server/explainer/planner";
import { VideoInputError } from "~/server/explainer/repository";
import { remakePosterRemotely } from "~/server/explainer/segments";
import {
  publicVideoArtifact,
  readVideoArtifact,
} from "~/server/explainer/store";
import { VoiceUnavailableError } from "~/server/explainer/voice";
import {
  readVisitor,
  withVisitorCookie,
  type Visitor,
} from "~/server/explainer/visitor";
import { errorText, logEvent } from "~/server/log";
import type {
  VideoArtifact,
  VideoGenerationEvent,
} from "~/features/explainer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A run gives up here, leaving the rest of maxDuration to report the failure,
// release its lock, and store the poster of a run that made it.
const VIDEO_DEADLINE_MS = 240_000;
// The lock and the paid-run place outlive the function if it dies.
const RUN_TTL_MS = 6 * 60_000;
// Everything, the poster included, is done by here: short of maxDuration, so
// the function always ends on its own rather than being stopped.
const FUNCTION_BUDGET_MS = 285_000;
// With less time than this left, the poster is not attempted (a poster can
// be remade later from the player).
const MIN_POSTER_MS = 20_000;

const requestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  /** A paid checkout's session id: the run skips the free rules. */
  paid: z.string().regex(PAID_SESSION).optional(),
});

const UNAVAILABLE_MESSAGE =
  "Video generation is unavailable right now. Try again soon.";
const BUSY_MESSAGE =
  "Lots of videos are being made right now. Try again in a few minutes.";
const NARRATOR_MESSAGE =
  "The narrator is unavailable right now. Try again in a few minutes.";
const REFUNDED = "Your payment has been refunded.";
const REFUND_PENDING = "Your payment will be refunded within the hour.";

/** The cap on paid runs at once was reached just before the first model call. */
class PaidRunsBusyError extends Error {}

/**
 * What the viewer is told when a run fails, and whether trying again could
 * help. Once paid work started, a failure keeps the visitor's daily place,
 * so for most people another try the same day would only meet their limit.
 */
function failureEvent(
  error: unknown,
  {
    timedOut,
    paid,
    trusted,
    bought = false,
  }: { timedOut: boolean; paid: boolean; trusted: boolean; bought?: boolean },
): Extract<VideoGenerationEvent, { status: "error" }> {
  if (error instanceof VideoInputError)
    return { status: "error", error: error.message, retryable: false };
  if (error instanceof VideoRefusalError)
    return {
      status: "error",
      error: "An explainer video can't be made for this repository.",
      retryable: false,
    };
  if (error instanceof VoiceUnavailableError)
    return { status: "error", error: NARRATOR_MESSAGE, retryable: true };
  if (error instanceof PaidRunsBusyError)
    return { status: "error", error: BUSY_MESSAGE, retryable: true };
  const failed = timedOut
    ? "The explainer video took too long to make."
    : "The explainer video could not be generated.";
  // A payer is refunded (the caller says so); another try means paying again.
  if (bought) return { status: "error", error: failed, retryable: false };
  return !paid || trusted
    ? { status: "error", error: `${failed} Try again.`, retryable: true }
    : {
        status: "error",
        error: `${failed} This try counted toward today's free videos.`,
        retryable: false,
      };
}

/** Every response names the visitor, so their next request counts as them. */
export async function POST(request: Request): Promise<Response> {
  const visitor = readVisitor(request);
  return withVisitorCookie(await generate(request, visitor), visitor);
}

async function generate(request: Request, visitor: Visitor): Promise<Response> {
  const requestStartedAt = Date.now();
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
  // Only the operator (or anyone, locally) skips the limits, and only they may
  // replace a video: once made, a video is everyone's.
  const trusted = await isTrustedVideoCaller(request);
  // A payer skips every free rule (see payments.ts). Their payment is claimed
  // first, and given back whenever the run does not go ahead or fails.
  const paidSession = trusted ? undefined : parsed.data.paid;
  const production = process.env.NODE_ENV === "production";
  const clientIp = getClientIp(request);
  const requester = { visitorId: visitor.id, clientIp };
  const gated = (reason: string) =>
    reportHeldBack(request, { username, repo, reason, step: "start" });
  // Someone in a priority place may make more videos a day, and their first
  // is made with the premium model (see planner.ts).
  let priority = false;
  // Someone let in from a limited country makes at most one video a day, with
  // the standard models (see features/admin/limited-countries.ts).
  let limited = false;
  if (!trusted && !paidSession) {
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
      return jsonErrorResponse(pausedMessage("paused"), 503);
    }
    const blocked = audienceBlock(
      request,
      controls.videoAudience,
      controls.priorityPlaces,
    );
    if (blocked) {
      gated(blocked);
      return jsonErrorResponse(audienceMessage(blocked), 403);
    }
    const country = limitedCountryRule(request, controls, getClientIp(request));
    if (country === "blocked") {
      gated("country");
      return jsonErrorResponse(audienceMessage("place"), 403);
    }
    limited = country === "limited";
    priority = isInVideoRegion(request, controls.priorityPlaces);
  }

  // `reason` lets the panel show the video (or wait for it) instead of an error.
  const alreadyMade = () =>
    Response.json(
      {
        ok: false,
        error: "This repository already has a video.",
        reason: "exists",
      },
      { status: 409, headers: NO_STORE_RESPONSE_HEADERS },
    );
  let reservation: Reservation | null = null;
  let payment: ClaimedPayment | null = null;
  let releaseLock: (() => Promise<void>) | null = null;
  let releaseRun: (() => Promise<void>) | null = null;
  const release = async () => {
    await releaseRun?.();
    await releaseLock?.();
  };
  // Gives a claimed payment back, once, and says so to the payer.
  const refundPayment = async (reason: string) => {
    if (!payment) return "";
    const refunded = await payment.refund(reason);
    payment = null;
    return ` ${refunded ? REFUNDED : REFUND_PENDING}`;
  };
  // Hands back what admission took when no run starts after all.
  const turnAway = async (response: Response, reason = "not started") => {
    if (reservation?.ok) await reservation.refund();
    await refundPayment(reason);
    await release();
    return response;
  };
  try {
    if (paidSession) {
      const claim = await claimVideoPayment(paidSession, username, repo);
      if (!claim.ok)
        return claim.status === 409
          ? Response.json(
              { ok: false, error: claim.error, reason: "generating" },
              { status: 409, headers: NO_STORE_RESPONSE_HEADERS },
            )
          : jsonErrorResponse(claim.error, claim.status);
      payment = claim.payment;
    }
    if (!trusted && (await readVideoArtifact(username, repo)))
      return await turnAway(alreadyMade(), "video exists");
    if (!trusted && !(await isNarrationAvailable())) {
      gated("voice");
      const note = await refundPayment("narrator unavailable");
      return jsonErrorResponse(pausedMessage("voice") + note, 503);
    }
    if (!trusted && !paidSession) {
      reservation = await reserveVideoSlot(requester, { priority, limited });
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
          Response.json(
            {
              ok: false,
              error:
                "This video is being made right now. It will be here in about a minute.",
              reason: "generating",
            },
            { status: 409, headers: NO_STORE_RESPONSE_HEADERS },
          ),
          "video being made",
        );
      // Checked again under the lock: a run that finished between the first
      // check and taking the lock has stored its video by now.
      if (!trusted && (await readVideoArtifact(username, repo)))
        return await turnAway(alreadyMade(), "video exists");
    }
    if (!trusted && !paidSession) {
      // The run reads the repository from GitHub next. That read is counted
      // per connection and never refunded, so failing runs cannot repeat it
      // without end (see takeVideoAttempt).
      const attempt = await takeVideoAttempt(clientIp);
      if (!attempt.ok) {
        gated("attempts");
        return await turnAway(
          jsonErrorResponse(
            attemptLimitMessage(attempt.retryAfterSeconds),
            429,
          ),
        );
      }
    }
  } catch (error) {
    // Redis and storage hold the budget and the videos, so without them
    // nothing new is started.
    logEvent("error", "video.admission_failed", { error: errorText(error) });
    const note = await refundPayment("admission failed");
    return turnAway(jsonErrorResponse(UNAVAILABLE_MESSAGE + note, 503));
  }

  const siteOrigin = new URL(request.url).origin;
  const origin = requestOrigin(request);
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  // The job id stays free of the repository's name, which may be private.
  const jobId = `video:${startedAt}:${randomUUID().slice(0, 8)}`;
  const deadline = AbortSignal.timeout(VIDEO_DEADLINE_MS);
  let stored: VideoArtifact | null = null;
  // Reading the repository proved it public, so the feed may name it.
  let confirmedPublic = false;
  // A model has been called: from here on the run costs real money.
  let paid = false;
  // The visitor's premium video for today, if this run took it.
  let refundPremium: (() => Promise<void>) | undefined;
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
            model: event.progress?.model,
            bought: Boolean(paidSession),
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
        // Paid runs at once are capped, and a run only takes its place here,
        // once it has read the repository, so runs that fail before any
        // model call never crowd out ones that are being paid for.
        onPaidWork: async () => {
          if (production) {
            releaseRun = await tryPaidVideoRun({
              operator: trusted,
              ttlMs: RUN_TTL_MS,
            });
            if (!releaseRun) {
              gated("busy");
              throw new PaidRunsBusyError("Too many paid runs at once.");
            }
          }
          paid = true;
        },
        choosePlanner: async ({ stars }) => {
          const choice = await choosePlanner({
            operator: trusted,
            stars,
            priority,
            standardOnly: limited,
            takePremium: () => takePremiumVideo(requester),
          });
          refundPremium = choice.refund;
          return choice.planner;
        },
        signal: deadline,
      })
        .then(
          async (artifact) => {
            stored = artifact;
            await payment?.done();
            send({
              status: "complete",
              artifact: publicVideoArtifact(artifact),
            });
            clearInterval(heartbeat);
            close();
          },
          async (error: unknown) => {
            logEvent("error", "video.generation_failed", {
              repository,
              paid,
              timedOut: deadline.aborted,
              error: errorText(error, 300),
            });
            const failure = failureEvent(error, {
              timedOut: deadline.aborted,
              paid,
              trusted,
              bought: payment !== null,
            });
            // A payer gets their money back whatever went wrong, and paying
            // again would not help today.
            if (payment) {
              const note = await refundPayment("run failed");
              send({
                ...failure,
                error: failure.error + note,
                retryable: false,
              });
            } else send(failure);
            // Only a failure before any model call is refunded. After that the
            // run was paid for, and a refund would let one failing repository
            // be retried for free again and again. A narrator out of credit is
            // the operator's doing, not the visitor's, so that is refunded too.
            if (!paid || error instanceof VoiceUnavailableError) {
              if (reservation?.ok) await reservation.refund();
              await refundPremium?.();
            }
          },
        )
        .catch((error: unknown) => {
          logEvent("error", "video.generation_cleanup_failed", {
            error: errorText(error),
          });
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
            outcome: stored ? "complete" : "error",
            ms: Date.now() - startedAt,
            ...(confirmedPublic ? { job: { id: jobId, state: "end" } } : {}),
          });
        });
    },
    cancel() {
      closed = true;
    },
  });
  // Once the run has settled (and released its lock), point the pages that
  // name the video at the new one, then make its link-preview poster on a
  // render instance, within what is left of this function's time.
  after(async () => {
    await job;
    const artifact = stored;
    if (!artifact) return;
    refreshVideoPages(username, repo);
    const left = FUNCTION_BUDGET_MS - (Date.now() - requestStartedAt);
    if (left < MIN_POSTER_MS) {
      logEvent("warn", "video.poster.skipped", { repository, leftMs: left });
      return;
    }
    if (await remakePosterRemotely(artifact, siteOrigin, { timeoutMs: left }))
      refreshVideoPages(username, repo);
    else logEvent("error", "video.poster.remote_failed", { repository });
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
