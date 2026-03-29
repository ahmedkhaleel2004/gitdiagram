import type { DiagramArtifact } from "./types";
import { getJsonObject, listObjects, putJsonObject } from "./r2";
import { readRequiredEnv } from "./config";
import { getGitHubAuthSources } from "../github-auth";

const PUBLIC_BROWSE_INDEX_KEY = "public/v1/_meta/browse-index.json";
const PUBLIC_DIAGRAM_ARTIFACT_PREFIX = "public/v1/";
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_API_VERSION = "2022-11-28";
const BROWSE_BACKFILL_READ_CONCURRENCY = 25;
const BROWSE_BACKFILL_ARTIFACT_CHUNK_SIZE = 250;
const BROWSE_BACKFILL_GITHUB_BATCH_SIZE = 50;
const BROWSE_BACKFILL_GITHUB_CONCURRENCY = 4;
const GITHUB_SECONDARY_LIMIT_MAX_RETRIES = 8;

export const BROWSE_PAGE_SIZE = 50;
export const MIN_STAR_FILTER_VALUES = [0, 10, 100, 1000] as const;
export const BROWSE_SORTS = [
  "recent_desc",
  "recent_asc",
  "stars_desc",
  "stars_asc",
  "name_asc",
] as const;

export type BrowseSort = (typeof BROWSE_SORTS)[number];

export interface BrowseIndexEntry {
  username: string;
  repo: string;
  lastSuccessfulAt: string;
  stargazerCount: number | null;
}

export interface BrowseQuery {
  q?: string | null;
  sort?: string | null;
  minStars?: string | number | null;
  page?: string | number | null;
}

export interface BrowsePageResult {
  items: BrowseIndexEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: BrowseSort;
  q: string;
  minStars: number;
}

interface BrowseIndexPayload {
  version: 1;
  updatedAt: string;
  entries: BrowseIndexEntry[];
}

interface GitHubRateLimitPayload {
  remaining?: number;
  resetAt?: string | null;
}

interface GitHubBatchResponse {
  data?: Record<
    string,
    | {
        stargazerCount?: number;
      }
    | GitHubRateLimitPayload
    | null
  >;
  errors?: Array<{ message?: string; type?: string }>;
}

type ListObjectsFn = typeof listObjects;
type PutJsonObjectFn = typeof putJsonObject;
type ReadJsonObjectFn = <T>(bucket: string, key: string) => Promise<T | null>;

interface BackfillBrowseIndexDeps {
  listObjectsFn?: ListObjectsFn;
  getJsonObjectFn?: ReadJsonObjectFn;
  putJsonObjectFn?: PutJsonObjectFn;
  fetchStarsFn?: (
    repos: Array<Pick<BrowseIndexEntry, "username" | "repo">>,
  ) => Promise<Map<string, number | null>>;
  now?: Date;
}

export class BrowseIndexNotFoundError extends Error {
  constructor() {
    super(
      `Browse index missing at ${PUBLIC_BROWSE_INDEX_KEY}. Run the browse backfill first.`,
    );
    this.name = "BrowseIndexNotFoundError";
  }
}

function getPublicBucket(): string {
  return readRequiredEnv("R2_PUBLIC_BUCKET");
}

function toRepoKey(entry: Pick<BrowseIndexEntry, "username" | "repo">) {
  return `${entry.username.trim().toLowerCase()}/${entry.repo.trim().toLowerCase()}`;
}

function compareIsoDatesDescending(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

function compareIsoDatesAscending(left: string, right: string) {
  return Date.parse(left) - Date.parse(right);
}

function compareNamesAscending(left: BrowseIndexEntry, right: BrowseIndexEntry) {
  return toRepoKey(left).localeCompare(toRepoKey(right));
}

function compareNullableStars(
  left: number | null,
  right: number | null,
  direction: "asc" | "desc",
) {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return direction === "asc" ? left - right : right - left;
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

function parseBrowseSort(sort: string | null | undefined): BrowseSort {
  return BROWSE_SORTS.includes(sort as BrowseSort)
    ? (sort as BrowseSort)
    : "recent_desc";
}

function parseMinStars(minStars: string | number | null | undefined): number {
  const numericValue =
    typeof minStars === "number"
      ? minStars
      : Number.parseInt(minStars ?? "0", 10);

  return MIN_STAR_FILTER_VALUES.includes(
    numericValue as (typeof MIN_STAR_FILTER_VALUES)[number],
  )
    ? numericValue
    : 0;
}

function parsePageNumber(page: string | number | null | undefined): number {
  const numericPage =
    typeof page === "number" ? page : Number.parseInt(page ?? "1", 10);

  if (!Number.isFinite(numericPage) || numericPage < 1) {
    return 1;
  }

  return Math.floor(numericPage);
}

function applyBrowseSort(
  entries: BrowseIndexEntry[],
  sort: BrowseSort,
): BrowseIndexEntry[] {
  const sortedEntries = [...entries];

  switch (sort) {
    case "recent_asc":
      return sortedEntries.sort((left, right) => {
        const result = compareIsoDatesAscending(
          left.lastSuccessfulAt,
          right.lastSuccessfulAt,
        );
        return result || compareNamesAscending(left, right);
      });
    case "stars_desc":
      return sortedEntries.sort((left, right) => {
        const result = compareNullableStars(
          left.stargazerCount,
          right.stargazerCount,
          "desc",
        );
        return result || compareNamesAscending(left, right);
      });
    case "stars_asc":
      return sortedEntries.sort((left, right) => {
        const result = compareNullableStars(
          left.stargazerCount,
          right.stargazerCount,
          "asc",
        );
        return result || compareNamesAscending(left, right);
      });
    case "name_asc":
      return sortedEntries.sort(compareNamesAscending);
    case "recent_desc":
    default:
      return sortedEntries.sort((left, right) => {
        const result = compareIsoDatesDescending(
          left.lastSuccessfulAt,
          right.lastSuccessfulAt,
        );
        return result || compareNamesAscending(left, right);
      });
  }
}

async function readStoredBrowseIndex(): Promise<BrowseIndexEntry[] | null> {
  return readStoredBrowseIndexWith(getJsonObject);
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
  const sort = parseBrowseSort(query.sort);
  const q = (query.q ?? "").trim();
  const normalizedQuery = q.toLowerCase();
  const minStars = parseMinStars(query.minStars);
  const requestedPage = parsePageNumber(query.page);
  const storedEntries = await readStoredBrowseIndex();
  if (!storedEntries) {
    throw new BrowseIndexNotFoundError();
  }

  const filteredEntries = storedEntries.filter((entry) => {
    const matchesQuery = normalizedQuery
      ? toRepoKey(entry).includes(normalizedQuery)
      : true;
    const matchesStarFilter =
      minStars === 0 ? true : (entry.stargazerCount ?? -1) >= minStars;
    return matchesQuery && matchesStarFilter;
  });

  const sortedEntries = applyBrowseSort(filteredEntries, sort);
  const total = sortedEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const startIndex = (page - 1) * BROWSE_PAGE_SIZE;

  return {
    items: sortedEntries.slice(startIndex, startIndex + BROWSE_PAGE_SIZE),
    total,
    page,
    pageSize: BROWSE_PAGE_SIZE,
    totalPages,
    sort,
    q,
    minStars,
  };
}

export function parsePublicArtifactKey(
  key: string,
): Pick<BrowseIndexEntry, "username" | "repo"> | null {
  if (!key.startsWith(PUBLIC_DIAGRAM_ARTIFACT_PREFIX)) {
    return null;
  }

  const relativeKey = key.slice(PUBLIC_DIAGRAM_ARTIFACT_PREFIX.length);
  if (relativeKey.startsWith("_meta/") || !relativeKey.endsWith(".json")) {
    return null;
  }

  const parts = relativeKey.split("/");
  if (parts.length !== 2) {
    return null;
  }

  const [encodedUsername, encodedRepoWithExt] = parts;
  if (!encodedUsername || !encodedRepoWithExt) {
    return null;
  }

  return {
    username: decodeURIComponent(encodedUsername).toLowerCase(),
    repo: decodeURIComponent(encodedRepoWithExt.replace(/\.json$/u, "")).toLowerCase(),
  };
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
      () => worker(),
    ),
  );

  return results;
}

async function waitForRateLimitReset(resetAt: string | null | undefined) {
  if (!resetAt) {
    return;
  }

  const parsedResetAt =
    /^\d+$/u.test(resetAt)
      ? Number.parseInt(resetAt, 10) * 1000
      : Date.parse(resetAt);
  const delayMs = parsedResetAt - Date.now();
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs + 1000));
  }
}

async function waitForSecondaryRateLimit(
  retryAfterHeader: string | null | undefined,
  attempt: number,
) {
  const retryAfterSeconds = retryAfterHeader
    ? Number.parseInt(retryAfterHeader, 10)
    : Number.NaN;
  const delayMs = Number.isFinite(retryAfterSeconds)
    ? retryAfterSeconds * 1000
    : Math.min(120_000, 5_000 * 2 ** attempt);

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isSecondaryRateLimitResponse(status: number, body: string) {
  return (
    (status === 403 || status === 429) &&
    body.toLowerCase().includes("secondary rate limit")
  );
}

function hasSecondaryRateLimitGraphQLError(
  payload: GitHubBatchResponse,
): boolean {
  return (
    payload.errors?.some((error) =>
      (error.message ?? "").toLowerCase().includes("secondary rate limit"),
    ) ?? false
  );
}

function buildGitHubRepositoryBatchQuery(
  repos: Array<Pick<BrowseIndexEntry, "username" | "repo">>,
): string {
  const repositoryQueries = repos
    .map(
      (repo, index) =>
        `repo_${index}: repository(owner: ${JSON.stringify(repo.username)}, name: ${JSON.stringify(repo.repo)}) { stargazerCount }`,
    )
    .join("\n");

  return `query BrowseRepositoryStars {\nrateLimit { remaining resetAt }\n${repositoryQueries}\n}`;
}

async function fetchGitHubStarsBatch(
  repos: Array<Pick<BrowseIndexEntry, "username" | "repo">>,
  token: string,
  attempt = 0,
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();

  for (const repo of repos) {
    result.set(toRepoKey(repo), null);
  }

  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({
      query: buildGitHubRepositoryBatchQuery(repos),
    }),
  });

  if (
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    await waitForRateLimitReset(response.headers.get("x-ratelimit-reset"));
    return fetchGitHubStarsBatch(repos, token, attempt);
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (
      isSecondaryRateLimitResponse(response.status, errorText) &&
      attempt < GITHUB_SECONDARY_LIMIT_MAX_RETRIES
    ) {
      await waitForSecondaryRateLimit(
        response.headers.get("retry-after"),
        attempt,
      );
      return fetchGitHubStarsBatch(repos, token, attempt + 1);
    }

    throw new Error(
      `GitHub GraphQL request failed (${response.status}): ${errorText}`,
    );
  }

  const payload = (await response.json()) as GitHubBatchResponse;
  const rateLimit = payload.data?.rateLimit as GitHubRateLimitPayload | undefined;

  if (
    payload.errors?.some((error) => error.type === "RATE_LIMITED") &&
    rateLimit?.resetAt
  ) {
    await waitForRateLimitReset(rateLimit.resetAt);
    return fetchGitHubStarsBatch(repos, token, attempt);
  }

  if (
    hasSecondaryRateLimitGraphQLError(payload) &&
    attempt < GITHUB_SECONDARY_LIMIT_MAX_RETRIES
  ) {
    await waitForSecondaryRateLimit(undefined, attempt);
    return fetchGitHubStarsBatch(repos, token, attempt + 1);
  }

  for (const [index, repo] of repos.entries()) {
    const node = payload.data?.[`repo_${index}`] as
      | { stargazerCount?: number }
      | null
      | undefined;

    result.set(
      toRepoKey(repo),
      typeof node?.stargazerCount === "number" ? node.stargazerCount : null,
    );
  }

  return result;
}

export async function fetchGitHubStarsInBatches(
  repos: Array<Pick<BrowseIndexEntry, "username" | "repo">>,
  options?: {
    batchSize?: number;
    concurrency?: number;
    fetchBatch?: (
      batch: Array<Pick<BrowseIndexEntry, "username" | "repo">>,
    ) => Promise<Map<string, number | null>>;
  },
): Promise<Map<string, number | null>> {
  const batchSize = options?.batchSize ?? BROWSE_BACKFILL_GITHUB_BATCH_SIZE;
  const concurrency =
    options?.concurrency ?? BROWSE_BACKFILL_GITHUB_CONCURRENCY;
  const authSources = options?.fetchBatch ? [] : getGitHubAuthSources();
  const fetchBatch = options?.fetchBatch;
  const uniqueRepos = Array.from(
    new Map(repos.map((repo) => [toRepoKey(repo), repo])).values(),
  );
  const batches: Array<Array<Pick<BrowseIndexEntry, "username" | "repo">>> = [];

  for (let index = 0; index < uniqueRepos.length; index += batchSize) {
    batches.push(uniqueRepos.slice(index, index + batchSize));
  }

  const maps = await mapWithConcurrency(
    batches.map((batch, index) => ({ batch, index })),
    concurrency,
    async ({ batch, index }) => {
      if (fetchBatch) {
        return fetchBatch(batch);
      }

      if (authSources.length === 0) {
        throw new Error(
          "Missing GitHub auth. Configure GITHUB_PAT/GITHUB_PATS or GitHub App env vars before running the browse index backfill.",
        );
      }

      const authSource = authSources[index % authSources.length]!;
      return fetchGitHubStarsBatch(batch, await authSource.getToken());
    },
  );

  const mergedMap = new Map<string, number | null>();

  for (const map of maps) {
    for (const [repoKey, stargazerCount] of map.entries()) {
      mergedMap.set(repoKey, stargazerCount);
    }
  }

  return mergedMap;
}

async function loadBrowseEntriesFromArtifacts(
  listObjectsFn: ListObjectsFn,
  getJsonObjectFn: ReadJsonObjectFn,
  options?: {
    seedEntries?: BrowseIndexEntry[];
    onChunkLoaded?: (entries: BrowseIndexEntry[]) => Promise<void>;
  },
): Promise<BrowseIndexEntry[]> {
  const seedEntries = normalizeBrowseIndexEntries(options?.seedEntries ?? []);
  const existingEntriesByRepo = new Map(
    seedEntries.map((entry) => [toRepoKey(entry), entry]),
  );
  const objects = await listObjectsFn(getPublicBucket(), PUBLIC_DIAGRAM_ARTIFACT_PREFIX);
  const artifactKeys = objects
    .map((object) => object.key)
    .filter((key): key is string => Boolean(parsePublicArtifactKey(key)));
  let accumulatedEntries: BrowseIndexEntry[] = seedEntries;

  for (
    let startIndex = 0;
    startIndex < artifactKeys.length;
    startIndex += BROWSE_BACKFILL_ARTIFACT_CHUNK_SIZE
  ) {
    const chunk = artifactKeys.slice(
      startIndex,
      startIndex + BROWSE_BACKFILL_ARTIFACT_CHUNK_SIZE,
    );

    const chunkEntries = await mapWithConcurrency(
      chunk,
      BROWSE_BACKFILL_READ_CONCURRENCY,
      async (key) => {
        const artifact = await getJsonObjectFn<DiagramArtifact>(
          getPublicBucket(),
          key,
        );
        if (!artifact) {
          return null;
        }

        const repoKey = toRepoKey({
          username: artifact.username,
          repo: artifact.repo,
        });
        const existingEntry = existingEntriesByRepo.get(repoKey);

        return {
          username: artifact.username,
          repo: artifact.repo,
          lastSuccessfulAt:
            artifact.lastSuccessfulAt ??
            artifact.generatedAt ??
            new Date(0).toISOString(),
          stargazerCount:
            typeof artifact.stargazerCount === "number"
              ? artifact.stargazerCount
              : existingEntry?.stargazerCount ?? null,
        } satisfies BrowseIndexEntry;
      },
    );

    accumulatedEntries = normalizeBrowseIndexEntries([
      ...accumulatedEntries,
      ...chunkEntries.filter(
        (entry): entry is BrowseIndexEntry => Boolean(entry),
      ),
    ]);

    await options?.onChunkLoaded?.(accumulatedEntries);
  }

  return accumulatedEntries;
}

export async function backfillBrowseIndex(
  deps: BackfillBrowseIndexDeps = {},
): Promise<BrowseIndexEntry[]> {
  const listObjectsFn = deps.listObjectsFn ?? listObjects;
  const getJsonObjectFn = deps.getJsonObjectFn ?? getJsonObject;
  const putJsonObjectFn = deps.putJsonObjectFn ?? putJsonObject;
  const now = deps.now ?? new Date();
  const existingEntries =
    (await readStoredBrowseIndexWith(getJsonObjectFn)) ?? [];
  const loadedEntries = await loadBrowseEntriesFromArtifacts(
    listObjectsFn,
    getJsonObjectFn,
    {
      seedEntries: existingEntries,
      onChunkLoaded: async (entries) => {
        await writeBrowseIndex(entries, putJsonObjectFn, now);
      },
    },
  );

  const fetchStarsFn = deps.fetchStarsFn;
  const entriesMissingStars = loadedEntries.filter(
    (entry) => entry.stargazerCount === null,
  );
  if (fetchStarsFn) {
    const starCounts = await fetchStarsFn(entriesMissingStars);
    const finalEntries = normalizeBrowseIndexEntries(
      loadedEntries.map((entry) => ({
        ...entry,
        stargazerCount:
          starCounts.get(toRepoKey(entry)) ?? entry.stargazerCount,
      })),
    );
    return writeBrowseIndex(finalEntries, putJsonObjectFn, now);
  }

  let entriesWithStars = loadedEntries;

  for (
    let startIndex = 0;
    startIndex < entriesMissingStars.length;
    startIndex += BROWSE_BACKFILL_GITHUB_BATCH_SIZE
  ) {
    const batch = entriesMissingStars.slice(
      startIndex,
      startIndex + BROWSE_BACKFILL_GITHUB_BATCH_SIZE,
    );
    const batchStarCounts = await fetchGitHubStarsInBatches(batch, {
      batchSize: BROWSE_BACKFILL_GITHUB_BATCH_SIZE,
      concurrency: 1,
    });

    entriesWithStars = normalizeBrowseIndexEntries(
      entriesWithStars.map((entry) => ({
        ...entry,
        stargazerCount:
          batchStarCounts.get(toRepoKey(entry)) ?? entry.stargazerCount,
      })),
    );

    await writeBrowseIndex(entriesWithStars, putJsonObjectFn, now);
  }

  return entriesWithStars;
}

export async function fillMissingBrowseIndexStars(
  deps: Pick<
    BackfillBrowseIndexDeps,
    "getJsonObjectFn" | "putJsonObjectFn" | "fetchStarsFn" | "now"
  > = {},
): Promise<BrowseIndexEntry[]> {
  const getJsonObjectFn = deps.getJsonObjectFn ?? getJsonObject;
  const putJsonObjectFn = deps.putJsonObjectFn ?? putJsonObject;
  const now = deps.now ?? new Date();
  const existingEntries =
    (await readStoredBrowseIndexWith(getJsonObjectFn)) ?? [];

  if (existingEntries.length === 0) {
    throw new BrowseIndexNotFoundError();
  }

  const entriesMissingStars = existingEntries.filter(
    (entry) => entry.stargazerCount === null,
  );

  if (entriesMissingStars.length === 0) {
    return existingEntries;
  }

  const starCounts = deps.fetchStarsFn
    ? await deps.fetchStarsFn(entriesMissingStars)
    : await fetchGitHubStarsInBatches(entriesMissingStars, {
        batchSize: BROWSE_BACKFILL_GITHUB_BATCH_SIZE,
        concurrency: 1,
      });

  const updatedEntries = normalizeBrowseIndexEntries(
    existingEntries.map((entry) => ({
      ...entry,
      stargazerCount: starCounts.get(toRepoKey(entry)) ?? entry.stargazerCount,
    })),
  );

  return writeBrowseIndex(updatedEntries, putJsonObjectFn, now);
}
