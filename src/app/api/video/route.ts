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
import { readVideoArtifact } from "~/server/explainer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const querySchema = z.object({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
});

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
  return Response.json(
    { ok: true, video, canGenerate: canGenerateVideos() },
    { headers: NO_STORE_RESPONSE_HEADERS },
  );
}
