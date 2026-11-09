import "server-only";

import { unstable_cache } from "next/cache";
import {
  relatedFromShard,
  relatedShardId,
  type RelatedDiagrams,
} from "~/features/browse/related";
import { errorText, logEvent } from "~/server/log";
import { readRelatedShard } from "./related-diagrams";

// A route's ISR lifetime is the shortest revalidate read while rendering it
// (the same trick as public-diagram-state.ts).
const shortenPageLifetime = unstable_cache(
  async () => true,
  ["repo-page-related-failure"],
  { revalidate: 60 },
);

// Matches the repository page's `revalidate`: the shards change once a day,
// and the rebuild drops every cached copy (RELATED_SHARDS_TAG).
const RELATED_REVALIDATE_SECONDS = 21600;
export const RELATED_SHARDS_TAG = "related-shards";

function getCachedShard(id: string) {
  return unstable_cache(
    async () => {
      // All 256 shards always exist once built, so a missing one is a fault
      // (or the very first build has not run): never cache it as "no links".
      const shard = await readRelatedShard(id);
      if (!shard) throw new Error(`Related shard ${id} missing`);
      return shard;
    },
    ["related-shard-v1", id],
    {
      revalidate: RELATED_REVALIDATE_SECONDS,
      tags: [RELATED_SHARDS_TAG],
    },
  )();
}

/**
 * Other public diagrams in the repository's language, or null (none, or the
 * read failed: the page then simply leaves the line out).
 */
export async function readRelatedDiagrams(
  username: string,
  repo: string,
): Promise<RelatedDiagrams | null> {
  const key = `${username}/${repo}`.toLowerCase();
  try {
    return relatedFromShard(await getCachedShard(relatedShardId(key)), key);
  } catch (error) {
    logEvent("warn", "repo_page.related_failed", {
      repository: key,
      error: errorText(error),
    });
    // Without the line this render is cached briefly, not for six hours.
    await shortenPageLifetime().catch(() => undefined);
    return null;
  }
}
