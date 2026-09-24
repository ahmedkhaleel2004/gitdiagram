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
import { canMakeVideosHere } from "~/server/explainer/audience";
import { videosLeftToday } from "~/server/explainer/limits";
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
): Promise<{ canGenerate: boolean; paused: "audience" | "limit" | null }> {
  if (!canGenerateVideos()) return { canGenerate: false, paused: "limit" };
  if (process.env.NODE_ENV !== "production") {
    // Local preview of the paused states: VIDEO_PREVIEW_PAUSED=audience|limit.
    const preview = process.env.VIDEO_PREVIEW_PAUSED;
    return preview === "audience" || preview === "limit"
      ? { canGenerate: false, paused: preview }
      : { canGenerate: true, paused: null };
  }
  if (!canMakeVideosHere(request))
    return { canGenerate: false, paused: "audience" };
  try {
    const [left, credits] = await Promise.all([
      videosLeftToday(),
      hasNarrationCredits(),
    ]);
    return left > 0 && credits
      ? { canGenerate: true, paused: null }
      : { canGenerate: false, paused: "limit" };
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
    { ok: true, video: null, ...(await videoAvailability(request)) },
    { headers: NO_STORE_RESPONSE_HEADERS },
  );
}
