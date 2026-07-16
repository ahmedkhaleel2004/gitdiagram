export const BROWSE_PAGE_SIZE = 20;
const MIN_STAR_FILTER_VALUES = [0, 10, 100, 1000] as const;
const BROWSE_SORTS = [
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

export interface RecentBrowseIndex {
  entries: BrowseIndexEntry[];
  total: number;
}

interface NormalizedBrowseQuery {
  page: number;
  sort: BrowseSort;
  q: string;
  minStars: number;
}

interface PreparedBrowseEntry {
  entry: BrowseIndexEntry;
  lastSuccessfulAtTimestamp: number;
  repoKey: string;
}

export interface PreparedBrowseIndex {
  preparedEntries: PreparedBrowseEntry[];
  sortedEntries: Map<BrowseSort, PreparedBrowseEntry[]>;
}

export function toRepoKey(entry: Pick<BrowseIndexEntry, "username" | "repo">) {
  return `${entry.username.trim().toLowerCase()}/${entry.repo.trim().toLowerCase()}`;
}

function comparePreparedNamesAscending(
  left: PreparedBrowseEntry,
  right: PreparedBrowseEntry,
) {
  return left.repoKey.localeCompare(right.repoKey);
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

export function normalizeBrowseQuery(
  query: BrowseQuery,
): NormalizedBrowseQuery {
  return {
    sort: parseBrowseSort(query.sort),
    q: (query.q ?? "").trim(),
    minStars: parseMinStars(query.minStars),
    page: parsePageNumber(query.page),
  };
}

export function prepareBrowseIndex(
  entries: BrowseIndexEntry[],
  initialSort?: BrowseSort,
): PreparedBrowseIndex {
  const preparedEntries = entries.map((entry) => ({
    entry,
    lastSuccessfulAtTimestamp: Date.parse(entry.lastSuccessfulAt),
    repoKey: toRepoKey(entry),
  }));

  return {
    preparedEntries,
    sortedEntries: initialSort
      ? new Map([[initialSort, preparedEntries]])
      : new Map(),
  };
}

function getSortedPreparedEntries(
  index: PreparedBrowseIndex,
  sort: BrowseSort,
): PreparedBrowseEntry[] {
  const cachedEntries = index.sortedEntries.get(sort);
  if (cachedEntries) {
    return cachedEntries;
  }

  const sortedEntries = [...index.preparedEntries].sort((left, right) => {
    let result = 0;

    switch (sort) {
      case "recent_asc":
        result =
          left.lastSuccessfulAtTimestamp - right.lastSuccessfulAtTimestamp;
        break;
      case "stars_desc":
        result = compareNullableStars(
          left.entry.stargazerCount,
          right.entry.stargazerCount,
          "desc",
        );
        break;
      case "stars_asc":
        result = compareNullableStars(
          left.entry.stargazerCount,
          right.entry.stargazerCount,
          "asc",
        );
        break;
      case "name_asc":
        return comparePreparedNamesAscending(left, right);
      case "recent_desc":
      default:
        result =
          right.lastSuccessfulAtTimestamp - left.lastSuccessfulAtTimestamp;
        break;
    }

    return result || comparePreparedNamesAscending(left, right);
  });

  index.sortedEntries.set(sort, sortedEntries);
  return sortedEntries;
}

export function getBrowsePageFromPreparedIndex(
  index: PreparedBrowseIndex,
  query: BrowseQuery,
): BrowsePageResult {
  const {
    sort,
    q,
    minStars,
    page: requestedPage,
  } = normalizeBrowseQuery(query);
  const normalizedQuery = q.toLowerCase();
  const filteredEntries = getSortedPreparedEntries(index, sort).filter(
    ({ entry, repoKey }) => {
      const matchesQuery = normalizedQuery
        ? repoKey.includes(normalizedQuery)
        : true;
      const matchesStarFilter =
        minStars === 0 ? true : (entry.stargazerCount ?? -1) >= minStars;
      return matchesQuery && matchesStarFilter;
    },
  );

  const total = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const startIndex = (page - 1) * BROWSE_PAGE_SIZE;

  return {
    items: filteredEntries
      .slice(startIndex, startIndex + BROWSE_PAGE_SIZE)
      .map(({ entry }) => entry),
    total,
    page,
    pageSize: BROWSE_PAGE_SIZE,
    totalPages,
    sort,
    q,
    minStars,
  };
}

export function getBrowsePageFromEntries(
  entries: BrowseIndexEntry[],
  query: BrowseQuery,
): BrowsePageResult {
  return getBrowsePageFromPreparedIndex(prepareBrowseIndex(entries), query);
}

export function getBrowsePageFromRecentIndex(
  index: RecentBrowseIndex,
  query: BrowseQuery,
): BrowsePageResult | null {
  const normalized = normalizeBrowseQuery(query);
  if (
    normalized.q ||
    normalized.sort !== "recent_desc" ||
    normalized.minStars !== 0
  ) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(index.total / BROWSE_PAGE_SIZE));
  const page = Math.min(normalized.page, totalPages);
  const startIndex = (page - 1) * BROWSE_PAGE_SIZE;
  const endIndex = Math.min(startIndex + BROWSE_PAGE_SIZE, index.total);
  if (endIndex > index.entries.length) {
    return null;
  }

  return {
    items: index.entries.slice(startIndex, endIndex),
    total: index.total,
    page,
    pageSize: BROWSE_PAGE_SIZE,
    totalPages,
    sort: normalized.sort,
    q: normalized.q,
    minStars: normalized.minStars,
  };
}

export function parseBrowseQueryFromSearchParams(
  searchParams: URLSearchParams,
): NormalizedBrowseQuery {
  return normalizeBrowseQuery({
    q: searchParams.get("q"),
    sort: searchParams.get("sort"),
    minStars: searchParams.get("minStars"),
    page: searchParams.get("page"),
  });
}

export function buildBrowseSearchParams(
  query: Pick<BrowsePageResult, "q" | "sort" | "minStars"> & {
    page?: number;
  },
): URLSearchParams {
  const params = new URLSearchParams();

  if (query.q) {
    params.set("q", query.q);
  }
  if (query.sort !== "recent_desc") {
    params.set("sort", query.sort);
  }
  if (query.minStars > 0) {
    params.set("minStars", String(query.minStars));
  }
  if ((query.page ?? 1) > 1) {
    params.set("page", String(query.page));
  }

  return params;
}

export function buildBrowseHref(
  query: Pick<BrowsePageResult, "q" | "sort" | "minStars"> & {
    page?: number;
  },
) {
  const queryString = buildBrowseSearchParams(query).toString();
  return queryString ? `/browse?${queryString}` : "/browse";
}
