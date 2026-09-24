import { z } from "zod";

import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { jsonErrorResponse } from "~/server/http/same-origin-json";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import {
  readRender,
  readVideoArtifact,
  renderDownloadUrl,
  type RenderName,
} from "~/server/explainer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const querySchema = z.object({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  format: z.enum(["landscape", "vertical", "poster", "still"]),
  // The video's createdAt: renders live under their video's version folder.
  v: z.iso.datetime(),
});

const FILES: Record<"landscape" | "vertical" | "poster" | "still", RenderName> =
  {
    landscape: "landscape.mp4",
    vertical: "vertical.mp4",
    poster: "poster.jpg",
    still: "still.jpg",
  };

/**
 * A stored render. Posters stream (they are small and feed link previews);
 * MP4s redirect to a short-lived signed R2 URL so large files never pass
 * through a function.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) return jsonErrorResponse("Invalid file request.", 400);
  const { username, repo, format, v } = parsed.data;
  const artifact = await readVideoArtifact(username, repo);
  if (!artifact) return jsonErrorResponse("This video does not exist.", 404);
  const version = { ...artifact, createdAt: v };
  const name = FILES[format];
  const filename = `${artifact.meta.owner}-${artifact.meta.repo}-explained${format === "vertical" ? "-vertical" : ""}.mp4`;

  if (format === "landscape" || format === "vertical") {
    const signed = await renderDownloadUrl(version, name, filename);
    if (signed)
      return new Response(null, {
        status: 302,
        headers: { Location: signed, "Cache-Control": "no-store" },
      });
  }
  const body = await readRender(version, name);
  if (!body) return jsonErrorResponse("This file has not been made yet.", 404);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": name.endsWith(".jpg") ? "image/jpeg" : "video/mp4",
      ...(name.endsWith(".jpg")
        ? {}
        : { "Content-Disposition": `attachment; filename="${filename}"` }),
      // The URL names the video version, so its bytes never change.
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
