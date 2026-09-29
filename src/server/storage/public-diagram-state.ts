import "server-only";

import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { DiagramStateResponse } from "~/features/diagram/types";
import { errorText, logEvent } from "~/server/log";
import { getStoredDiagramState } from "~/server/storage/artifact-store";
import { getPublicDiagramStateCacheTag } from "~/server/storage/repo-page-cache";

// The repository page, its metadata and its Markdown twin all read the same
// cached public artifact (never the private namespace): one R2 read per
// repository every six hours at most, or right after a new diagram
// (generation-persistence.ts revalidates the tag).

/** Matches the repository page's `revalidate`. */
const PUBLIC_DIAGRAM_STATE_REVALIDATE_SECONDS = 21600;

// How long a page rendered after a failed storage read stays cached.
const STORAGE_FAILURE_REVALIDATE_SECONDS = 60;

function getCachedPublicDiagramState(username: string, repo: string) {
  const getCachedState = unstable_cache(
    async () =>
      getStoredDiagramState({
        username,
        repo,
      }),
    ["public-diagram-state", username.toLowerCase(), repo.toLowerCase()],
    {
      revalidate: PUBLIC_DIAGRAM_STATE_REVALIDATE_SECONDS,
      tags: [getPublicDiagramStateCacheTag(username, repo)],
    },
  );

  return getCachedState();
}

// A route's ISR lifetime is the shortest revalidate used while rendering it,
// so reading this short-lived entry caches the page for a minute, not 6 h.
// Rethrowing instead would keep the last good page on a revalidation, but on
// a first render (nothing cached yet) Next answers 500, error.tsx or not; and
// connection()/unstable_noStore() fail an ISR render the same way ("Page
// changed from static to dynamic at runtime"). A failed read during a
// time-based revalidation never gets here: unstable_cache then serves its
// stale entry. It does after an on-demand revalidation, which expires it.
const shortenPageLifetime = unstable_cache(
  async () => true,
  ["repo-page-storage-failure"],
  { revalidate: STORAGE_FAILURE_REVALIDATE_SECONDS },
);

export interface PublicDiagramStateRead {
  /** The stored state, or null when there is none (or the read failed). */
  state: DiagramStateResponse | null;
  /** The read failed: nothing is known about the repository. */
  failed: boolean;
}

/**
 * The repository's stored public diagram state. A slow or failing R2 never
 * throws: the caller renders without it, and that render is only cached
 * briefly. Caught outside the cache, so a failed read is never cached as
 * "none". Deduplicated per request (page and metadata share one read).
 */
export const readPublicDiagramState = cache(
  async (username: string, repo: string): Promise<PublicDiagramStateRead> => {
    try {
      const state = await getCachedPublicDiagramState(username, repo);
      return { state: state?.diagram ? state : null, failed: false };
    } catch (error) {
      logEvent("error", "repo_page.stored_state_failed", {
        repository: `${username}/${repo}`,
        error: errorText(error),
      });
      await shortenPageLifetime().catch(() => undefined);
      return { state: null, failed: true };
    }
  },
);
