import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";

// A new video for a repository replaces the stored one. The version it
// replaced keeps its files until the next regeneration, so open tabs still
// play; older versions are deleted (see pruneVideoFiles). The pages that
// name the video are refreshed here.

const repoKey = (username: string, repo: string) =>
  `${username.toLowerCase()}/${repo.toLowerCase()}`;

export const VIDEO_CATALOG_TAG = "explainer-video-catalog";

/** The watch page's summary of a repository's video (title, poster). */
export const videoSummaryTag = (username: string, repo: string) =>
  `explainer-video-summary:${repoKey(username, repo)}`;

/**
 * Marks an answer that names a repository's current video. The edge keeps a
 * tagged answer only briefly (cloudflare/edge-answers.ts), since nothing
 * tells every location when the video is replaced.
 */
export const videoResponseTag = (username: string, repo: string) =>
  `video/${repoKey(username, repo)}`;

/**
 * Refresh the pages that name the video: its watch page (link preview and
 * poster) and the /videos gallery. Call from a request, or its after().
 *
 * On Cloudflare the video routes run in the render Container, whose Next
 * cache is its own: with REVALIDATE_ORIGIN set, the site (the Worker, which
 * holds the pages visitors get) is told to do the same.
 */
export function refreshVideoPages(username: string, repo: string): void {
  refreshVideoPagesHere(username, repo);
  const origin = process.env.REVALIDATE_ORIGIN?.trim();
  if (origin) void refreshVideoPagesAt(origin, username, repo);
}

/** This instance's own cache (also what /api/internal/revalidate runs). */
export function refreshVideoPagesHere(username: string, repo: string): void {
  revalidateTag(videoSummaryTag(username, repo), { expire: 0 });
  revalidateTag(VIDEO_CATALOG_TAG, "max");
  revalidatePath(`/${repoKey(username, repo)}/video`);
}

async function refreshVideoPagesAt(
  origin: string,
  username: string,
  repo: string,
): Promise<void> {
  try {
    const response = await fetch(new URL("/api/internal/revalidate", origin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET?.trim() ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ video: { username, repo } }),
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new Error(`status ${response.status}`);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "video.cache_refresh_forward_failed",
        repository: repoKey(username, repo),
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
  }
}
