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

/** Whether a visitor could start a new video right now. */
async function canStartVideo(): Promise<boolean> {
  if (!canGenerateVideos()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  try {
    const [left, credits] = await Promise.all([
      videosLeftToday(),
      hasNarrationCredits(),
    ]);
    return left > 0 && credits;
  } catch {
    return false;
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
      { ok: true, video, canGenerate: false },
      {
        headers: {
          // A stored video changes only when the operator regenerates it.
          "Cache-Control":
            "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
        },
      },
    );
  return Response.json(
    { ok: true, video: null, canGenerate: await canStartVideo() },
    { headers: NO_STORE_RESPONSE_HEADERS },
  );
}
