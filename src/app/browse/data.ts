import type { BrowseIndexEntry } from "~/features/browse/catalog";
import { readBrowseIndex } from "~/server/storage/browse-diagrams";

const BROWSE_INDEX_TTL_MS = 5 * 60 * 1000;

let cachedBrowseIndex:
  | {
      entries: BrowseIndexEntry[] | null;
      expiresAt: number;
    }
  | null = null;
let inFlightBrowseIndexRead: Promise<BrowseIndexEntry[] | null> | null = null;

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
        expiresAt: now + BROWSE_INDEX_TTL_MS,
      };
      return entries;
    })
    .finally(() => {
      inFlightBrowseIndexRead = null;
    });

  return inFlightBrowseIndexRead;
}

export function revalidateBrowseIndexCache() {
  cachedBrowseIndex = null;
  inFlightBrowseIndexRead = null;
}
