import "server-only";

import { unstable_cache } from "next/cache";
import {
  relatedFromShard,
  relatedShardId,
  type RelatedDiagrams,
} from "~/features/browse/related";
import { errorText, logEvent } from "~/server/log";
import { readRelatedShard } from "./related-diagrams";

// Matches the repository page's `revalidate`: the shards change once a day.
const RELATED_REVALIDATE_SECONDS = 21600;

function getCachedShard(id: string) {
  return unstable_cache(() => readRelatedShard(id), ["related-shard-v1", id], {
    revalidate: RELATED_REVALIDATE_SECONDS,
  })();
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
    return null;
  }
}
