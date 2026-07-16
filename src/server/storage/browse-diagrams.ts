import { getGzipJsonObject, getJsonObject, putGzipJsonObject } from "./r2";
import { readRequiredEnv } from "./config";
import { withDistributedLock } from "./distributed-lock";
import {
  BROWSE_PAGE_SIZE,
  BROWSE_SORTS,
  getBrowsePageFromEntries,
  MIN_STAR_FILTER_VALUES,
  toRepoKey,
} from "~/features/browse/catalog";
import type {
  BrowseIndexEntry,
  BrowsePageResult,
  BrowseQuery,
  RecentBrowseIndex,
  BrowseSort,
} from "~/features/browse/catalog";

const LEGACY_PUBLIC_BROWSE_INDEX_KEY = "public/v1/_meta/browse-index.json";
const PUBLIC_BROWSE_INDEX_KEY = "public/v2/_meta/browse-index.json.gz";
const PUBLIC_RECENT_BROWSE_INDEX_KEY = "public/v2/_meta/browse-recent.json.gz";
const PUBLIC_BROWSE_INDEX_LOCK_KEY = "lock:v1:public-browse-index";
export const RECENT_BROWSE_INDEX_SIZE = 2_000;

export { BROWSE_PAGE_SIZE, BROWSE_SORTS, MIN_STAR_FILTER_VALUES };
export type { BrowseIndexEntry, BrowsePageResult, BrowseQuery, BrowseSort };

interface BrowseIndexPayload {
  version: 1 | 2;
  updatedAt: string;
  entries: BrowseIndexEntry[];
}

interface RecentBrowseIndexPayload extends RecentBrowseIndex {
  version: 1;
  updatedAt: string;
}

type PutGzipJsonObjectFn = typeof putGzipJsonObject;
type ReadJsonObjectFn = <T>(bucket: string, key: string) => Promise<T | null>;

export class BrowseIndexNotFoundError extends Error {
  constructor() {
    super(`Browse index missing at ${PUBLIC_BROWSE_INDEX_KEY}.`);
    this.name = "BrowseIndexNotFoundError";
  }
}

function getPublicBucket(): string {
  return readRequiredEnv("R2_PUBLIC_BUCKET");
}

function compareIsoDatesDescending(left: string, right: string) {
  const difference = Date.parse(right) - Date.parse(left);
  return Number.isFinite(difference) && difference !== 0 ? difference : 0;
}

function compareBrowseEntriesByRecent(
  left: BrowseIndexEntry,
  right: BrowseIndexEntry,
) {
  return (
    compareIsoDatesDescending(left.lastSuccessfulAt, right.lastSuccessfulAt) ||
    toRepoKey(left).localeCompare(toRepoKey(right))
  );
}

function normalizeBrowseIndexEntry(entry: BrowseIndexEntry): BrowseIndexEntry {
  return {
    username: entry.username.trim().toLowerCase(),
    repo: entry.repo.trim().toLowerCase(),
    lastSuccessfulAt: entry.lastSuccessfulAt,
    stargazerCount:
      typeof entry.stargazerCount === "number" ? entry.stargazerCount : null,
  };
}

function pickPreferredEntry(
  existing: BrowseIndexEntry | undefined,
  incoming: BrowseIndexEntry,
): BrowseIndexEntry {
  if (!existing) {
    return incoming;
  }

  const existingTime = Date.parse(existing.lastSuccessfulAt);
  const incomingTime = Date.parse(incoming.lastSuccessfulAt);

  if (Number.isFinite(incomingTime) && incomingTime > existingTime) {
    return incoming;
  }

  if (
    incomingTime === existingTime &&
    existing.stargazerCount === null &&
    incoming.stargazerCount !== null
  ) {
    return incoming;
  }

  return existing;
}

function normalizeBrowseIndexEntries(
  entries: BrowseIndexEntry[],
): BrowseIndexEntry[] {
  const deduped = new Map<string, BrowseIndexEntry>();

  for (const rawEntry of entries) {
    const entry = normalizeBrowseIndexEntry(rawEntry);
    const repoKey = toRepoKey(entry);
    deduped.set(repoKey, pickPreferredEntry(deduped.get(repoKey), entry));
  }

  return Array.from(deduped.values()).sort(compareBrowseEntriesByRecent);
}

function insertRecentEntry(
  entries: BrowseIndexEntry[],
  entry: BrowseIndexEntry,
) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const candidate = entries[middle];
    if (candidate && compareBrowseEntriesByRecent(candidate, entry) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  entries.splice(low, 0, entry);
}

async function readStoredBrowseIndex(): Promise<BrowseIndexEntry[] | null> {
  return readStoredBrowseIndexWith(getGzipJsonObject, getJsonObject);
}

export async function readBrowseIndex(): Promise<BrowseIndexEntry[] | null> {
  return readStoredBrowseIndex();
}

export async function readRecentBrowseIndex(): Promise<RecentBrowseIndex | null> {
  const stored = await getGzipJsonObject<RecentBrowseIndexPayload>(
    getPublicBucket(),
    PUBLIC_RECENT_BROWSE_INDEX_KEY,
  );
  if (!stored) {
    return null;
  }

  return {
    entries: stored.entries ?? [],
    total: stored.total ?? 0,
  };
}

export async function migrateBrowseIndexToCompressedV2(): Promise<number> {
  return withDistributedLock({
    key: PUBLIC_BROWSE_INDEX_LOCK_KEY,
    callback: async () => {
      const [compressed, recent] = await Promise.all([
        getGzipJsonObject<BrowseIndexPayload>(
          getPublicBucket(),
          PUBLIC_BROWSE_INDEX_KEY,
        ),
        getGzipJsonObject<RecentBrowseIndexPayload>(
          getPublicBucket(),
          PUBLIC_RECENT_BROWSE_INDEX_KEY,
        ),
      ]);
      if (compressed?.version === 2 && recent?.version === 1) {
        return compressed.entries?.length ?? 0;
      }

      const source =
        compressed ??
        (await getJsonObject<BrowseIndexPayload>(
          getPublicBucket(),
          LEGACY_PUBLIC_BROWSE_INDEX_KEY,
        ));
      if (!source) {
        throw new BrowseIndexNotFoundError();
      }

      const normalizedEntries = normalizeBrowseIndexEntries(
        source.entries ?? [],
      );
      if (compressed?.version === 2) {
        await writeRecentBrowseIndex(normalizedEntries);
        return normalizedEntries.length;
      }
      return (await writeBrowseIndex(normalizedEntries)).length;
    },
  });
}

async function readStoredBrowseIndexWith(
  getGzipJsonObjectFn: ReadJsonObjectFn,
  getJsonObjectFn: ReadJsonObjectFn,
): Promise<BrowseIndexEntry[] | null> {
  const compressed = await getGzipJsonObjectFn<BrowseIndexPayload>(
    getPublicBucket(),
    PUBLIC_BROWSE_INDEX_KEY,
  );
  const stored =
    compressed ??
    (await getJsonObjectFn<BrowseIndexPayload>(
      getPublicBucket(),
      LEGACY_PUBLIC_BROWSE_INDEX_KEY,
    ));

  if (!stored) {
    return null;
  }

  return stored.version === 2
    ? (stored.entries ?? [])
    : normalizeBrowseIndexEntries(stored.entries ?? []);
}

async function writeBrowseIndex(
  entries: BrowseIndexEntry[],
  putGzipJsonObjectFn: PutGzipJsonObjectFn = putGzipJsonObject,
  now = new Date(),
): Promise<BrowseIndexEntry[]> {
  const updatedAt = now.toISOString();
  await Promise.all([
    putGzipJsonObjectFn(getPublicBucket(), PUBLIC_BROWSE_INDEX_KEY, {
      version: 2,
      updatedAt,
      entries,
    } satisfies BrowseIndexPayload),
    writeRecentBrowseIndex(entries, putGzipJsonObjectFn, now),
  ]);

  return entries;
}

async function writeRecentBrowseIndex(
  entries: BrowseIndexEntry[],
  putGzipJsonObjectFn: PutGzipJsonObjectFn = putGzipJsonObject,
  now = new Date(),
): Promise<void> {
  await putGzipJsonObjectFn(getPublicBucket(), PUBLIC_RECENT_BROWSE_INDEX_KEY, {
    version: 1,
    updatedAt: now.toISOString(),
    total: entries.length,
    entries: entries.slice(0, RECENT_BROWSE_INDEX_SIZE),
  } satisfies RecentBrowseIndexPayload);
}
export async function upsertBrowseIndexEntry(
  entry: BrowseIndexEntry,
): Promise<BrowseIndexEntry[]> {
  return withDistributedLock({
    key: PUBLIC_BROWSE_INDEX_LOCK_KEY,
    callback: async () => {
      const existingEntries = (await readStoredBrowseIndex()) ?? [];
      const normalizedEntry = normalizeBrowseIndexEntry(entry);
      const existingIndex = existingEntries.findIndex(
        (candidate) =>
          candidate.username === normalizedEntry.username &&
          candidate.repo === normalizedEntry.repo,
      );
      const existingEntry = existingEntries[existingIndex];

      if (
        existingEntry &&
        pickPreferredEntry(existingEntry, normalizedEntry) === existingEntry
      ) {
        return existingEntries;
      }

      if (existingIndex >= 0) {
        existingEntries.splice(existingIndex, 1);
      }
      insertRecentEntry(existingEntries, normalizedEntry);
      return writeBrowseIndex(existingEntries);
    },
  });
}

export async function getBrowsePage(
  query: BrowseQuery,
): Promise<BrowsePageResult> {
  const storedEntries = await readStoredBrowseIndex();
  if (!storedEntries) {
    throw new BrowseIndexNotFoundError();
  }

  return getBrowsePageFromEntries(storedEntries, query);
}
