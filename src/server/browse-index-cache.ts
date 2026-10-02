import { revalidateTag, unstable_cache } from "next/cache";

import type { BrowseIndexEntry } from "~/features/browse/catalog";
import {
  BROWSE_PAGE_SIZE,
  getBrowsePageFromRecentIndex,
  getBrowsePageFromPreparedIndex,
  normalizeBrowseQuery,
  prepareBrowseIndex,
  type PreparedBrowseIndex,
} from "~/features/browse/catalog";
import type {
  BrowsePageResult,
  BrowseQuery,
  RecentBrowseIndex,
} from "~/features/browse/catalog";
import { sharedRead } from "~/server/shared-read";
import {
  readBrowseIndex,
  readRecentBrowseIndex,
  RECENT_BROWSE_INDEX_SIZE,
} from "~/server/storage/browse-diagrams";

const BROWSE_CACHE_REVALIDATE_SECONDS = 5 * 60;
const BROWSE_INDEX_CACHE_TAG = "browse-index";
const readRecentBrowseIndexFromDataCache = unstable_cache(
  readRecentBrowseIndex,
  ["browse-recent-index-v1"],
  {
    revalidate: BROWSE_CACHE_REVALIDATE_SECONDS,
    tags: [BROWSE_INDEX_CACHE_TAG],
  },
);

let cachedBrowseIndex: {
  entries: BrowseIndexEntry[] | null;
  expiresAt: number;
  preparedIndex: PreparedBrowseIndex | null;
} | null = null;
let cachedRecentBrowseIndex: {
  index: RecentBrowseIndex | null;
  expiresAt: number;
} | null = null;
let browseIndexCacheGeneration = 0;

// One read in flight per instance; a read started before the cache was
// dropped (`forget`) finishes for its callers but is not kept.
const sharedRecentBrowseIndexRead = sharedRead(() => {
  const readGeneration = browseIndexCacheGeneration;
  return readRecentBrowseIndexFromDataCache().then((index) => {
    if (readGeneration === browseIndexCacheGeneration) {
      cachedRecentBrowseIndex = {
        index,
        expiresAt: Date.now() + BROWSE_CACHE_REVALIDATE_SECONDS * 1000,
      };
    }
    return index;
  });
});

const sharedBrowseIndexRead = sharedRead(() => {
  const readGeneration = browseIndexCacheGeneration;
  return readBrowseIndex().then((entries) => {
    if (readGeneration === browseIndexCacheGeneration) {
      cachedBrowseIndex = {
        entries,
        expiresAt: Date.now() + BROWSE_CACHE_REVALIDATE_SECONDS * 1000,
        preparedIndex: entries
          ? prepareBrowseIndex(entries, "recent_desc")
          : null,
      };
    }
    return entries;
  });
});

async function getCachedRecentBrowseIndex(): Promise<RecentBrowseIndex | null> {
  const now = Date.now();
  if (cachedRecentBrowseIndex && cachedRecentBrowseIndex.expiresAt > now) {
    return cachedRecentBrowseIndex.index;
  }
  return sharedRecentBrowseIndexRead();
}

export async function getCachedBrowseIndex(): Promise<
  BrowseIndexEntry[] | null
> {
  const now = Date.now();

  if (cachedBrowseIndex && cachedBrowseIndex.expiresAt > now) {
    return cachedBrowseIndex.entries;
  }

  return sharedBrowseIndexRead();
}

export async function getCachedBrowsePage(
  query: BrowseQuery,
): Promise<BrowsePageResult | null> {
  const normalizedQuery = normalizeBrowseQuery(query);
  const requestedStart = (normalizedQuery.page - 1) * BROWSE_PAGE_SIZE;
  if (
    !normalizedQuery.q &&
    normalizedQuery.sort === "recent_desc" &&
    normalizedQuery.minStars === 0 &&
    requestedStart < RECENT_BROWSE_INDEX_SIZE
  ) {
    const recentIndex = await getCachedRecentBrowseIndex();
    if (recentIndex) {
      const recentPage = getBrowsePageFromRecentIndex(recentIndex, query);
      if (recentPage) {
        return recentPage;
      }
    }
  }

  const entries = await getCachedBrowseIndex();
  if (!entries) {
    return null;
  }

  const preparedIndex =
    cachedBrowseIndex?.entries === entries
      ? cachedBrowseIndex.preparedIndex
      : prepareBrowseIndex(entries, "recent_desc");
  return preparedIndex
    ? getBrowsePageFromPreparedIndex(preparedIndex, query)
    : null;
}

export function revalidateBrowseIndexCache() {
  browseIndexCacheGeneration += 1;
  cachedBrowseIndex = null;
  sharedBrowseIndexRead.forget();
  cachedRecentBrowseIndex = null;
  sharedRecentBrowseIndexRead.forget();
  revalidateTag(BROWSE_INDEX_CACHE_TAG, "max");
}
