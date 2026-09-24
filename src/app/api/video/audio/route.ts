import { z } from "zod";

import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { jsonErrorResponse } from "~/server/http/same-origin-json";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { readVoiceClip } from "~/server/explainer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const querySchema = z.object({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  beat: z.coerce.number().int().min(0).max(31),
});

export async function GET(request: Request): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    username: url.searchParams.get("username"),
    repo: url.searchParams.get("repo"),
    beat: url.searchParams.get("beat"),
  });
  if (!parsed.success)
    return jsonErrorResponse("Invalid narration request.", 400);
  const clip = await readVoiceClip(
    parsed.data.username,
    parsed.data.repo,
    parsed.data.beat,
  );
  if (!clip) return jsonErrorResponse("Narration not found.", 404);
  return new Response(new Uint8Array(clip), {
    headers: {
      "Content-Type": "audio/mpeg",
      // The player adds the artifact's createdAt as ?v=, so a regenerated
      // video gets new URLs and each clip can be cached indefinitely.
      "Cache-Control": url.searchParams.has("v")
        ? "public, max-age=31536000, immutable"
        : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
