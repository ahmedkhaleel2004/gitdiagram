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
import { readControls } from "~/server/admin/controls";
import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import { audienceBlock } from "~/server/explainer/audience";
import { isVideoAdmin, videosLeftToday } from "~/server/explainer/limits";
import { hasNarrationCredits } from "~/server/explainer/narration";
import { readVideoArtifact } from "~/server/explainer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const querySchema = z.object({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
});

/**
 * Whether this visitor could start a new video right now, and if not, why:
 * "audience" (early access is limited to a few places) or "limit" (today's
 * budget is spent).
 */
async function videoAvailability(
  request: Request,
  repository: string,
): Promise<{
  canGenerate: boolean;
  paused: "audience" | "limit" | null;
  openToAll?: boolean;
}> {
  if (!canGenerateVideos()) return { canGenerate: false, paused: "limit" };
  if (process.env.NODE_ENV !== "production") {
    // Local preview of the paused states: VIDEO_PREVIEW_PAUSED=audience|limit.
    const preview = process.env.VIDEO_PREVIEW_PAUSED;
    return preview === "audience" || preview === "limit"
      ? { canGenerate: false, paused: preview }
      : { canGenerate: true, paused: null };
  }
  // The operator, signed in to /admin, may always make videos.
  if (isVideoAdmin(request))
    return { canGenerate: true, paused: null, openToAll: true };
  // Someone wanted a video and was held back: demand the operator sees, with
  // the reason, on the /admin feed.
  const heldBack = (reason: string) =>
    void emitLiveEvent({
      kind: "video.gated",
      repo: repository,
      reason,
      step: "page",
      ...requestOrigin(request),
    });
  const controls = await readControls();
  // "Everyone" includes tablets, which the page otherwise holds back.
  const openToAll = controls.videoAudience === "everyone";
  if (controls.videosPaused) {
    heldBack("paused");
    return { canGenerate: false, paused: "limit" };
  }
  const blocked = audienceBlock(request, controls.videoAudience);
  if (blocked) {
    heldBack(blocked);
    return { canGenerate: false, paused: "audience" };
  }
  try {
    const [left, credits] = await Promise.all([
      videosLeftToday(),
      hasNarrationCredits(),
    ]);
    if (left > 0 && credits)
      return { canGenerate: true, paused: null, openToAll };
    heldBack(left > 0 ? "credits" : "daily");
    return { canGenerate: false, paused: "limit" };
  } catch {
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
  const video = await readVideoArtifact(parsed.data.username, parsed.data.repo);
  if (video)
    return Response.json(
      { ok: true, video, canGenerate: false, paused: null },
      {
        headers: {
          // A stored video changes only when the operator regenerates it.
          "Cache-Control":
            "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
        },
      },
    );
  return Response.json(
    {
      ok: true,
      video: null,
      ...(await videoAvailability(
        request,
        `${parsed.data.username}/${parsed.data.repo}`,
      )),
    },
    { headers: NO_STORE_RESPONSE_HEADERS },
  );
}
