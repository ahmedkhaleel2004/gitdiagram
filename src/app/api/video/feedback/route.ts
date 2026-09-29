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
import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import {
  canSendFeedback,
  sendVideoFeedback,
} from "~/server/explainer/feedback";
import { takeFeedbackSend } from "~/server/explainer/limits";
import { readVideoArtifact } from "~/server/explainer/store";
import { errorText, logEvent } from "~/server/log";
import { modelLabel } from "~/features/explainer/model-label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_MESSAGE = 4000;

const feedbackSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  email: z
    .union([z.literal(""), z.email().max(254)])
    .optional()
    .transform((value) => value || undefined),
  at: z
    .number()
    .min(0)
    .max(24 * 3600)
    .optional(),
});

/** Whether this visitor gets the feedback button. Never cached: it is theirs. */
export async function GET(request: Request): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  return Response.json(
    { ok: true, canSend: await canSendFeedback(request) },
    { headers: NO_STORE_RESPONSE_HEADERS },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: feedbackSchema,
    maxBytes: 16 * 1024,
    crossOriginError: "Feedback must be sent from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  const { username, repo, message, email, at } = parsed.data;

  if (!(await canSendFeedback(request)))
    return jsonErrorResponse("Feedback is not open here yet.", 403);

  try {
    const { ok } = await takeFeedbackSend(getClientIp(request));
    if (!ok)
      return jsonErrorResponse(
        "That's a lot of feedback for one hour. Thank you! Try again later.",
        429,
      );
  } catch {
    return jsonErrorResponse("Could not send feedback. Try again.", 503);
  }

  // Only feedback on a video that exists, and the email says which one.
  const video = await readVideoArtifact(username, repo);
  if (!video) return jsonErrorResponse("This video no longer exists.", 404);

  try {
    await sendVideoFeedback(
      {
        owner: video.meta.owner,
        repo: video.meta.repo,
        message,
        email,
        at,
        duration: video.timing.DURATION,
        createdAt: video.createdAt,
        model: modelLabel(video.stats.model) || "an unknown model",
      },
      request,
    );
  } catch (error) {
    logEvent("error", "video.feedback.failed", {
      repo: `${username}/${repo}`,
      error: errorText(error),
    });
    return jsonErrorResponse("Could not send feedback. Try again.", 502);
  }
  logEvent("info", "video.feedback.sent", { repo: `${username}/${repo}` });
  void emitLiveEvent({
    kind: "video.feedback",
    repo: `${video.meta.owner}/${video.meta.repo}`,
    note: message.replace(/\s+/g, " ").slice(0, 80),
    ...requestOrigin(request),
  });
  return Response.json({ ok: true }, { headers: NO_STORE_RESPONSE_HEADERS });
}
