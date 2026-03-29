import { getJsonObject, putJsonObject } from "./r2";
import { readRequiredEnv } from "./config";
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
  BrowseSort,
} from "~/features/browse/catalog";

const PUBLIC_BROWSE_INDEX_KEY = "public/v1/_meta/browse-index.json";

export { BROWSE_PAGE_SIZE, BROWSE_SORTS, MIN_STAR_FILTER_VALUES };
export type {
  BrowseIndexEntry,
  BrowsePageResult,
  BrowseQuery,
  BrowseSort,
};

interface BrowseIndexPayload {
  version: 1;
  updatedAt: string;
  entries: BrowseIndexEntry[];
}

type PutJsonObjectFn = typeof putJsonObject;
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
  return Date.parse(right) - Date.parse(left);
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

  return Array.from(deduped.values()).sort((left, right) =>
    compareIsoDatesDescending(left.lastSuccessfulAt, right.lastSuccessfulAt),
  );
}

async function readStoredBrowseIndex(): Promise<BrowseIndexEntry[] | null> {
  return readStoredBrowseIndexWith(getJsonObject);
}

export async function readBrowseIndex(): Promise<BrowseIndexEntry[] | null> {
  return readStoredBrowseIndex();
}

async function readStoredBrowseIndexWith(
  getJsonObjectFn: ReadJsonObjectFn,
): Promise<BrowseIndexEntry[] | null> {
  const stored = await getJsonObjectFn<BrowseIndexPayload>(
    getPublicBucket(),
    PUBLIC_BROWSE_INDEX_KEY,
  );

  if (!stored) {
    return null;
  }

  return normalizeBrowseIndexEntries(stored.entries ?? []);
}

async function writeBrowseIndex(
  entries: BrowseIndexEntry[],
  putJsonObjectFn: PutJsonObjectFn = putJsonObject,
  now = new Date(),
): Promise<BrowseIndexEntry[]> {
  const normalizedEntries = normalizeBrowseIndexEntries(entries);

  await putJsonObjectFn(getPublicBucket(), PUBLIC_BROWSE_INDEX_KEY, {
    version: 1,
    updatedAt: now.toISOString(),
    entries: normalizedEntries,
  } satisfies BrowseIndexPayload);

  return normalizedEntries;
}
export async function upsertBrowseIndexEntry(
  entry: BrowseIndexEntry,
): Promise<BrowseIndexEntry[]> {
  const existingEntries = (await readStoredBrowseIndex()) ?? [];
  return writeBrowseIndex([...existingEntries, entry]);
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
