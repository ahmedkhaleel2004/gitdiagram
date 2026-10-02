import { revalidatePath, revalidateTag } from "next/cache";

import {
  getPublicDiagramStateCacheTag,
  getRepoPagePath,
  getRequestedRepoPagePath,
} from "./repo-page-cache";

/**
 * Drops every cached copy that shows a repository's stored diagram: the page
 * (as stored, and as the caller spelled it), its link-preview picture, the
 * README picture and the cached read of the artifact that the page, its
 * metadata and its Markdown twin share. Call from a request or its after().
 * Also what /api/internal/revalidate runs when a diagram was replaced from
 * outside the site (an operator repair).
 */
export function refreshDiagramPagesHere(username: string, repo: string): void {
  const normalizedPath = getRepoPagePath(username, repo);
  const requestedPath = getRequestedRepoPagePath(username, repo);
  revalidatePath(normalizedPath);
  revalidatePath(`${normalizedPath}/opengraph-image`);
  // The README picture (diagram.png) always shows the latest diagram.
  revalidatePath(`${normalizedPath}/diagram.png`);
  if (requestedPath !== normalizedPath) {
    revalidatePath(requestedPath);
    revalidatePath(`${requestedPath}/opengraph-image`);
  }
  revalidateTag(
    getPublicDiagramStateCacheTag(username, repo),
    // A regenerated diagram must survive the very next reload.
    // "max" serves the previous artifact once while refreshing it.
    { expire: 0 },
  );
}
