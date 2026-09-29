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
  generationLockName,
  isVideoLockHeld,
  takeCheckout,
} from "~/server/explainer/limits";
import {
  canSellVideos,
  createVideoCheckout,
} from "~/server/explainer/payments";
import { isPublicRepository } from "~/server/explainer/repository";
import { readVideoArtifact } from "~/server/explainer/store";
import {
  readVisitor,
  withVisitorCookie,
  type Visitor,
} from "~/server/explainer/visitor";
import { errorText, logEvent } from "~/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const requestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
});

const UNAVAILABLE_MESSAGE =
  "Buying a video is unavailable right now. Try again soon.";

/**
 * Open a Stripe checkout for one repository's video (see payments.ts). The
 * run itself starts when Stripe sends the payer back to the watch page. The
 * checks here stop people paying for a video that could not be made.
 */
export async function POST(request: Request): Promise<Response> {
  const visitor = readVisitor(request);
  return withVisitorCookie(await checkout(request, visitor), visitor);
}

async function checkout(request: Request, visitor: Visitor): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 512,
    crossOriginError: "Buy videos from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  const { username, repo } = parsed.data;
  if (!(await canSellVideos()))
    return jsonErrorResponse(UNAVAILABLE_MESSAGE, 503);
  try {
    const allowed = await takeCheckout(getClientIp(request));
    if (!allowed.ok)
      return jsonErrorResponse(
        "Too many checkouts from this connection. Try again later.",
        429,
      );
    if (await readVideoArtifact(username, repo))
      return jsonErrorResponse("This repository already has a video.", 409);
    if (
      process.env.NODE_ENV === "production" &&
      (await isVideoLockHeld(generationLockName(username, repo)))
    )
      return jsonErrorResponse(
        "This video is being made right now. It will be here in about a minute.",
        409,
      );
    // Videos are only made of public repositories.
    if (!(await isPublicRepository(username, repo)))
      return jsonErrorResponse(
        "Videos can only be made of public repositories.",
        400,
      );
    const url = await createVideoCheckout({
      username,
      repo,
      visitorId: visitor.id,
      siteOrigin: new URL(request.url).origin,
    });
    void emitLiveEvent({
      kind: "video.checkout",
      repo: `${username}/${repo}`,
      ...requestOrigin(request),
    });
    return Response.json(
      { ok: true, url },
      { headers: NO_STORE_RESPONSE_HEADERS },
    );
  } catch (error) {
    logEvent("error", "video.checkout_failed", { error: errorText(error) });
    return jsonErrorResponse(UNAVAILABLE_MESSAGE, 503);
  }
}
