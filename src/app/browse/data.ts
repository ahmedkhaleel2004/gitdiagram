import { revalidateTag, unstable_cache } from "next/cache";

import type { BrowseIndexEntry } from "~/features/browse/catalog";
import {
  getBrowsePageFromEntries,
  toRepoKey,
} from "~/features/browse/catalog";
import { getPublicDiagramPreview } from "~/server/storage/artifact-store";
import { readBrowseIndex } from "~/server/storage/browse-diagrams";

const BROWSE_CACHE_REVALIDATE_SECONDS = 5 * 60;
const BROWSE_INDEX_CACHE_TAG = "browse-index";
const DEFAULT_BROWSE_PREVIEWS_CACHE_TAG = "browse-default-previews";

let cachedBrowseIndex:
  | {
      entries: BrowseIndexEntry[] | null;
      expiresAt: number;
    }
  | null = null;
let inFlightBrowseIndexRead: Promise<BrowseIndexEntry[] | null> | null = null;

const getDefaultBrowsePreviewDiagramsFromCache = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const entries = await readBrowseIndex();
    if (!entries) {
      return {};
    }

    const previewItems = getBrowsePageFromEntries(entries, {}).items;
    const previews = await Promise.all(
      previewItems.map(async (entry) => {
        const preview = await getPublicDiagramPreview({
          username: entry.username,
          repo: entry.repo,
        });

        return preview?.diagram ? [toRepoKey(entry), preview.diagram] : null;
      }),
    );

    return Object.fromEntries(
      previews.filter((preview): preview is [string, string] => preview !== null),
    );
  },
  [DEFAULT_BROWSE_PREVIEWS_CACHE_TAG],
  {
    revalidate: BROWSE_CACHE_REVALIDATE_SECONDS,
    tags: [BROWSE_INDEX_CACHE_TAG, DEFAULT_BROWSE_PREVIEWS_CACHE_TAG],
  },
);

export async function getCachedBrowseIndex(): Promise<BrowseIndexEntry[] | null> {
  const now = Date.now();

  if (cachedBrowseIndex && cachedBrowseIndex.expiresAt > now) {
    return cachedBrowseIndex.entries;
  }

  if (inFlightBrowseIndexRead) {
    return inFlightBrowseIndexRead;
  }

  inFlightBrowseIndexRead = readBrowseIndex()
    .then((entries) => {
      cachedBrowseIndex = {
        entries,
        expiresAt: now + BROWSE_CACHE_REVALIDATE_SECONDS * 1000,
      };
      return entries;
    })
    .finally(() => {
      inFlightBrowseIndexRead = null;
    });

  return inFlightBrowseIndexRead;
}

export async function getCachedDefaultBrowsePreviewDiagrams(): Promise<
  Record<string, string>
> {
  return getDefaultBrowsePreviewDiagramsFromCache();
}

export function revalidateBrowseIndexCache() {
  cachedBrowseIndex = null;
  inFlightBrowseIndexRead = null;
  revalidateTag(BROWSE_INDEX_CACHE_TAG, "max");
  revalidateTag(DEFAULT_BROWSE_PREVIEWS_CACHE_TAG, "max");
}
