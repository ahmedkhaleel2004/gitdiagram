export const BROWSE_PAGE_SIZE = 20;
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

interface NormalizedBrowseQuery {
  page: number;
  sort: BrowseSort;
  q: string;
  minStars: number;
}

function compareIsoDatesDescending(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

function compareIsoDatesAscending(left: string, right: string) {
  return Date.parse(left) - Date.parse(right);
}

export function toRepoKey(entry: Pick<BrowseIndexEntry, "username" | "repo">) {
  return `${entry.username.trim().toLowerCase()}/${entry.repo.trim().toLowerCase()}`;
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

export function parseBrowseSort(sort: string | null | undefined): BrowseSort {
  return BROWSE_SORTS.includes(sort as BrowseSort)
    ? (sort as BrowseSort)
    : "recent_desc";
}

export function parseMinStars(
  minStars: string | number | null | undefined,
): number {
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

export function parsePageNumber(
  page: string | number | null | undefined,
): number {
  const numericPage =
    typeof page === "number" ? page : Number.parseInt(page ?? "1", 10);

  if (!Number.isFinite(numericPage) || numericPage < 1) {
    return 1;
  }

  return Math.floor(numericPage);
}

export function normalizeBrowseQuery(query: BrowseQuery): NormalizedBrowseQuery {
  return {
    sort: parseBrowseSort(query.sort),
    q: (query.q ?? "").trim(),
    minStars: parseMinStars(query.minStars),
    page: parsePageNumber(query.page),
  };
}

export function applyBrowseSort(
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

export function getBrowsePageFromEntries(
  entries: BrowseIndexEntry[],
  query: BrowseQuery,
): BrowsePageResult {
  const { sort, q, minStars, page: requestedPage } = normalizeBrowseQuery(query);
  const normalizedQuery = q.toLowerCase();
  const filteredEntries = entries.filter((entry) => {
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
