import { z } from "zod";

import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
} from "~/server/http/same-origin-json";
import {
  canGenerateVideos,
  isVideoExplainerEnabled,
} from "~/server/explainer/config";
import { readAdmissionControls } from "~/server/admin/controls";
import { videoResponseTag } from "~/server/explainer/cache";
import { anyDeviceHere, audienceBlock } from "~/server/explainer/audience";
import { reportHeldBack } from "~/server/explainer/gate-notice";
import {
  generationLockName,
  isVideoAdmin,
  isVideoLockHeld,
  videosLeftToday,
} from "~/server/explainer/limits";
import { hasNarrationCredits } from "~/server/explainer/narration";
import { readVideoArtifact } from "~/server/explainer/store";
import { readVisitor, withVisitorCookie } from "~/server/explainer/visitor";
import type { VideoPausedReason } from "~/features/explainer/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const querySchema = z.object({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
});

/**
 * Whether this visitor could start a new video right now, and if not, why:
 * "audience" (early access is limited to a few places), "device" (open to
 * desktops only here) or "limit" (today's budget is spent).
 */
async function videoAvailability(
  request: Request,
  username: string,
  repo: string,
): Promise<{
  canGenerate: boolean;
  paused: VideoPausedReason | null;
  anyDevice?: boolean;
}> {
  if (!canGenerateVideos()) return { canGenerate: false, paused: "limit" };
  if (process.env.NODE_ENV !== "production") {
    // Local preview of the paused states: VIDEO_PREVIEW_PAUSED=audience|device|limit.
    const preview = process.env.VIDEO_PREVIEW_PAUSED;
    return preview === "audience" || preview === "device" || preview === "limit"
      ? { canGenerate: false, paused: preview }
      : { canGenerate: true, paused: null };
  }
  // The operator, signed in to /admin, may always make videos.
  if (isVideoAdmin(request))
    return { canGenerate: true, paused: null, anyDevice: true };
  // Someone wanted a video and was held back: demand the operator sees, with
  // the reason, on the /admin feed.
  const heldBack = (reason: string) =>
    reportHeldBack(request, { username, repo, reason, step: "page" });
  try {
    const controls = await readAdmissionControls();
    // Tablets pass as desktops here, so the page holds them back itself unless
    // this visitor may use any device.
    const anyDevice = anyDeviceHere(request, controls.videoAudience);
    if (controls.videosPaused) {
      heldBack("paused");
      return { canGenerate: false, paused: "limit" };
    }
    const blocked = audienceBlock(request, controls.videoAudience);
    if (blocked) {
      heldBack(blocked);
      return {
        canGenerate: false,
        paused: blocked === "mobile" ? "device" : "audience",
      };
    }
    const [left, credits] = await Promise.all([
      videosLeftToday(),
      hasNarrationCredits(),
    ]);
    if (left > 0 && credits)
      return { canGenerate: true, paused: null, anyDevice };
    heldBack(left > 0 ? "credits" : "daily");
    return { canGenerate: false, paused: "limit" };
  } catch {
    // Without Redis nothing new can start (see the generate route).
    return { canGenerate: false, paused: "limit" };
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    username: url.searchParams.get("username"),
    repo: url.searchParams.get("repo"),
  });
  if (!parsed.success) return jsonErrorResponse("Invalid repository.", 400);
  const { username, repo } = parsed.data;
  const video = await readVideoArtifact(username, repo);
  if (video)
    return Response.json(
      { ok: true, video, canGenerate: false, paused: null },
      {
        headers: {
          // A stored video changes only when the operator regenerates it,
          // which drops this copy by its tag (see purgeVideoResponse).
          "Cache-Control":
            "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
          "Vercel-Cache-Tag": videoResponseTag(username, repo),
        },
      },
    );
  const [availability, generating] = await Promise.all([
    videoAvailability(request, username, repo),
    // A run in progress, which the page can wait for instead of offering a
    // new one. Only production takes the lock.
    process.env.NODE_ENV === "production"
      ? isVideoLockHeld(generationLockName(username, repo))
      : false,
  ]);
  // Never cached, so a waiting page sees the video once it lands. This is
  // also where a browser gets the visitor id that starting a video needs; the
  // cached answer above never carries one.
  return withVisitorCookie(
    Response.json(
      { ok: true, video: null, generating, ...availability },
      { headers: NO_STORE_RESPONSE_HEADERS },
    ),
    readVisitor(request),
  );
}
