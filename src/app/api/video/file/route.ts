import { z } from "zod";

import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { PICTURE_ID } from "~/features/explainer/types";
import { jsonErrorResponse } from "~/server/http/same-origin-json";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { probePicture } from "~/server/explainer/readme-images";
import {
  hasRender,
  readPicture,
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
  format: z.enum(["landscape", "vertical", "poster", "still", "picture"]),
  // A README picture the film shows (format "picture").
  id: z.string().regex(PICTURE_ID).optional(),
  // The video's createdAt: renders live under their video's version folder.
  v: z.iso.datetime(),
  // When a poster or still was made. A remake keeps the file's name, so this
  // is what gives it a new URL.
  p: z
    .string()
    .regex(/^\d{1,16}$/)
    .optional(),
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
  const { username, repo, format, v, p, id } = parsed.data;
  if (format === "picture") {
    // Named by the video version, so the bytes behind a URL never change.
    const body = id ? await readPicture(username, repo, v, id) : null;
    // Its type comes from its own bytes, checked when it was stored.
    const picture = body && probePicture(body);
    if (!body || !picture)
      return jsonErrorResponse("This picture does not exist.", 404);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": picture.type,
        "Cache-Control":
          "public, max-age=31536000, s-maxage=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const artifact = await readVideoArtifact(username, repo);
  if (!artifact) return jsonErrorResponse("This video does not exist.", 404);
  const version = { ...artifact, createdAt: v };
  const name = FILES[format];
  const filename = `${artifact.meta.owner}-${artifact.meta.repo}-explained${format === "vertical" ? "-vertical" : ""}.mp4`;
  const missing = () =>
    jsonErrorResponse("This file has not been made yet.", 404);

  const mp4 = format === "landscape" || format === "vertical";
  if (mp4) {
    const signed = await renderDownloadUrl(version, name, filename);
    if (signed) {
      // A signed URL for a file that is not there lands on R2's XML error.
      if (!(await hasRender(version, name))) return missing();
      return new Response(null, {
        status: 302,
        headers: { Location: signed, "Cache-Control": "no-store" },
      });
    }
  }
  const body = await readRender(version, name);
  if (!body) return missing();
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": mp4 ? "video/mp4" : "image/jpeg",
      ...(mp4
        ? { "Content-Disposition": `attachment; filename="${filename}"` }
        : {}),
      "Cache-Control": mp4
        ? // Only local storage streams MP4s, and its URL does not name the
          // engine that drew the file.
          "no-store"
        : p
          ? // The URL names the video version and when the poster was made,
            // so its bytes never change.
            "public, max-age=31536000, s-maxage=31536000, immutable"
          : // Without a stamp a remade poster would reuse this URL.
            "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
