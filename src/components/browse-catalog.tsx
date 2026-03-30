"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";

import {
  buildBrowseHref,
  getBrowsePageFromEntries,
  normalizeBrowseQuery,
  parseBrowseQueryFromSearchParams,
} from "~/features/browse/catalog";
import type {
  BrowseIndexEntry,
  BrowseQuery,
  BrowseSort,
} from "~/features/browse/catalog";
import { preloadBrowseIndex } from "~/features/browse/index-client";
import { Skeleton } from "~/components/ui/skeleton";

interface BrowseCatalogProps {
  entries?: BrowseIndexEntry[];
  initialQuery: BrowseQuery;
}

const starCountFormatter = new Intl.NumberFormat("en");
const generatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const sortOptions: Array<{ value: BrowseSort; label: string }> = [
  { value: "recent_desc", label: "Most Recent" },
  { value: "recent_asc", label: "Oldest First" },
  { value: "stars_desc", label: "Most Stars" },
  { value: "stars_asc", label: "Fewest Stars" },
  { value: "name_asc", label: "Name (A-Z)" },
];

const minStarOptions = [
  { value: 0, label: "Any Stars" },
  { value: 10, label: "10+" },
  { value: 100, label: "100+" },
  { value: 1000, label: "1,000+" },
];

const browseSkeletonRows = Array.from({ length: 6 }, (_, index) => index);
const BROWSE_SESSION_STORAGE_KEY = "gitdiagram:browse-query";

function formatStarCount(stargazerCount: number | null) {
  return stargazerCount === null
    ? "—"
    : starCountFormatter.format(stargazerCount);
}

function formatGeneratedAt(value: string) {
  return generatedAtFormatter.format(new Date(value));
}

function formatStarSummary(stargazerCount: number | null) {
  return stargazerCount === null
    ? "No star data"
    : `${formatStarCount(stargazerCount)} stars`;
}

function syncBrowseUrl(
  nextState: {
    page: number;
    q: string;
    sort: BrowseSort;
    minStars: number;
  },
  mode: "push" | "replace",
) {
  const nextHref = buildBrowseHref(nextState);
  const historyMethod =
    mode === "push" ? window.history.pushState : window.history.replaceState;

  historyMethod.call(window.history, null, "", nextHref);
}

function persistBrowseState(state: {
  page: number;
  q: string;
  sort: BrowseSort;
  minStars: number;
}) {
  try {
    window.sessionStorage.setItem(
      BROWSE_SESSION_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignore session storage failures and keep URL-based state as the fallback.
  }
}

function readPersistedBrowseState() {
  try {
    const storedState = window.sessionStorage.getItem(
      BROWSE_SESSION_STORAGE_KEY,
    );
    if (!storedState) {
      return null;
    }

    return normalizeBrowseQuery(JSON.parse(storedState) as BrowseQuery);
  } catch {
    return null;
  }
}

function isHistoryTraversalNavigation() {
  const [navigationEntry] = window.performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];

  return navigationEntry?.type === "back_forward";
}

function BrowseCatalogControls(props: {
  minStars: number;
  onMinStarsChange: (value: number) => void;
  onSearchChange: (value: string) => void;
  onSortChange: (value: BrowseSort) => void;
  searchInput: string;
  sort: BrowseSort;
}) {
  return (
    <div className="neo-panel grid gap-4 rounded-lg p-5 md:grid-cols-[minmax(0,1fr)_220px_180px] md:gap-5 md:p-6">
      <label className="flex flex-col gap-5">
        <span className="text-sm font-semibold tracking-[0.16em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          Search Repositories
        </span>
        <input
          type="search"
          value={props.searchInput}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder="owner/repo"
          className="neo-input w-full rounded-md bg-[hsl(var(--background))] px-4 py-3 text-base placeholder:text-gray-700 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none dark:placeholder:text-[hsl(var(--foreground))]"
        />
      </label>

      <label className="flex flex-col gap-5">
        <span className="text-sm font-semibold tracking-[0.16em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          Sort
        </span>
        <select
          value={props.sort}
          onChange={(event) =>
            props.onSortChange(event.target.value as BrowseSort)
          }
          className="neo-input h-[54px] w-full rounded-md bg-[hsl(var(--background))] px-4 text-base focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-5">
        <span className="text-sm font-semibold tracking-[0.16em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          Minimum Stars
        </span>
        <select
          value={String(props.minStars)}
          onChange={(event) =>
            props.onMinStarsChange(Number.parseInt(event.target.value, 10))
          }
          className="neo-input h-[54px] w-full rounded-md bg-[hsl(var(--background))] px-4 text-base focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
        >
          {minStarOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function BrowseCatalogLoadingState(props: {
  minStars: number;
  onMinStarsChange: (value: number) => void;
  onSearchChange: (value: string) => void;
  onSortChange: (value: BrowseSort) => void;
  searchInput: string;
  sort: BrowseSort;
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <BrowseCatalogControls {...props} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-72" />
      </div>

      <div className="neo-panel overflow-hidden rounded-lg">
        <div className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] px-4 py-3 text-left text-xs font-semibold tracking-[0.18em] uppercase lg:hidden dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
          Repository Results
        </div>
        <table className="w-full border-collapse lg:table-fixed">
          <colgroup className="hidden lg:table-column-group">
            <col />
            <col className="w-[110px] xl:w-[130px]" />
            <col className="w-[210px] xl:w-[240px]" />
            <col className="w-[244px] xl:w-[292px]" />
          </colgroup>
          <thead className="hidden lg:table-header-group">
            <tr className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] text-left text-sm tracking-[0.16em] uppercase dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
              <th className="px-5 py-4 font-semibold">Repository</th>
              <th className="px-5 py-4 font-semibold">Stars</th>
              <th className="px-5 py-4 font-semibold">Last Generated</th>
              <th className="px-5 py-4 font-semibold lg:pr-6 xl:pr-7">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="block lg:table-row-group">
            {browseSkeletonRows.map((row) => (
              <tr
                key={row}
                className="block border-b border-black/15 last:border-b-0 lg:table-row dark:border-white/10"
              >
                <td className="block px-4 pt-5 lg:table-cell lg:px-5 lg:py-5">
                  <Skeleton className="h-10 w-full max-w-[32rem]" />
                  <Skeleton className="mt-3 h-7 w-28 lg:hidden" />
                </td>
                <td className="hidden px-5 py-5 lg:table-cell">
                  <Skeleton className="h-8 w-24" />
                </td>
                <td className="block px-4 pt-4 lg:table-cell lg:px-5 lg:py-5">
                  <Skeleton className="h-4 w-28 lg:hidden" />
                  <Skeleton className="mt-2 h-8 w-48" />
                </td>
                <td className="block px-4 py-4 lg:table-cell lg:px-5 lg:py-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:flex xl:gap-3 xl:whitespace-nowrap">
                    <Skeleton className="h-12 w-full lg:h-11 xl:w-40" />
                    <Skeleton className="h-12 w-full lg:h-11 xl:w-28" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-28" />
        <div className="flex gap-3">
          <Skeleton className="h-11 w-24 rounded-md" />
          <Skeleton className="h-11 w-24 rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function BrowseCatalog({
  entries: initialEntries,
  initialQuery,
}: BrowseCatalogProps) {
  const normalizedInitialQuery = normalizeBrowseQuery(initialQuery);
  const [entries, setEntries] = useState<BrowseIndexEntry[] | null>(
    initialEntries ?? null,
  );
  const [isLoaded, setIsLoaded] = useState(Boolean(initialEntries));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(normalizedInitialQuery.q);
  const [sort, setSort] = useState<BrowseSort>(normalizedInitialQuery.sort);
  const [minStars, setMinStars] = useState(normalizedInitialQuery.minStars);
  const [page, setPage] = useState(normalizedInitialQuery.page);
  const deferredQuery = useDeferredValue(searchInput);

  useEffect(() => {
    const urlState = parseBrowseQueryFromSearchParams(
      new URLSearchParams(window.location.search),
    );

    if (window.location.search) {
      setSearchInput(urlState.q);
      setSort(urlState.sort);
      setMinStars(urlState.minStars);
      setPage(urlState.page);
      return;
    }

    if (!isHistoryTraversalNavigation()) {
      return;
    }

    const restoredState = readPersistedBrowseState();
    if (!restoredState) {
      return;
    }

    setSearchInput(restoredState.q);
    setSort(restoredState.sort);
    setMinStars(restoredState.minStars);
    setPage(restoredState.page);
    syncBrowseUrl(restoredState, "replace");
  }, []);

  useEffect(() => {
    persistBrowseState({
      page,
      q: searchInput.trim(),
      sort,
      minStars,
    });
  }, [minStars, page, searchInput, sort]);

  useEffect(() => {
    if (initialEntries) {
      setEntries(initialEntries);
      setIsLoaded(true);
      setLoadError(null);
      return;
    }

    let cancelled = false;

    preloadBrowseIndex()
      .then((loadedEntries) => {
        if (cancelled) {
          return;
        }

        setEntries(loadedEntries);
        setIsLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load browse index.",
        );
        setIsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [initialEntries]);

  useEffect(() => {
    const handlePopState = () => {
      const nextState = parseBrowseQueryFromSearchParams(
        new URLSearchParams(window.location.search),
      );

      setSearchInput(nextState.q);
      setSort(nextState.sort);
      setMinStars(nextState.minStars);
      setPage(nextState.page);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    setPage(1);
    syncBrowseUrl(
      {
        page: 1,
        q: value.trim(),
        sort,
        minStars,
      },
      "replace",
    );
  };

  const handleSortChange = (value: BrowseSort) => {
    setSort(value);
    setPage(1);
    syncBrowseUrl(
      {
        page: 1,
        q: searchInput.trim(),
        sort: value,
        minStars,
      },
      "replace",
    );
  };

  const handleMinStarsChange = (value: number) => {
    setMinStars(value);
    setPage(1);
    syncBrowseUrl(
      {
        page: 1,
        q: searchInput.trim(),
        sort,
        minStars: value,
      },
      "replace",
    );
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    syncBrowseUrl(
      {
        page: nextPage,
        q: searchInput.trim(),
        sort,
        minStars,
      },
      "push",
    );
  };

  const result = entries
    ? getBrowsePageFromEntries(entries, {
        q: deferredQuery,
        sort,
        minStars,
        page,
      })
    : null;

  if (loadError) {
    return (
      <div className="neo-panel p-8">
        <p className="text-sm font-semibold tracking-[0.2em] text-black/70 uppercase dark:text-[hsl(var(--foreground))]">
          Browse
        </p>
        <h2 className="mt-3 text-3xl font-bold">Browse index unavailable</h2>
        <p className="mt-4 max-w-3xl text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
          {loadError}
        </p>
      </div>
    );
  }

  if (isLoaded && entries === null) {
    return (
      <div className="neo-panel p-8">
        <p className="text-sm font-semibold tracking-[0.2em] text-black/70 uppercase dark:text-[hsl(var(--foreground))]">
          Browse
        </p>
        <h2 className="mt-3 text-3xl font-bold">Browse index unavailable</h2>
        <p className="mt-4 max-w-3xl text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
          This page reads only the hosted browse index. The index is currently
          unavailable in storage.
        </p>
      </div>
    );
  }

  if (!isLoaded || result === null) {
    return (
      <BrowseCatalogLoadingState
        minStars={minStars}
        onMinStarsChange={handleMinStarsChange}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        searchInput={searchInput}
        sort={sort}
      />
    );
  }

  const showingStart =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingEnd = Math.min(result.total, result.page * result.pageSize);
  const hasPreviousPage = result.page > 1;
  const hasNextPage = result.page < result.totalPages;

  return (
    <div className="space-y-6">
      <BrowseCatalogControls
        minStars={minStars}
        onMinStarsChange={handleMinStarsChange}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        searchInput={searchInput}
        sort={sort}
      />

      {result.total === 0 ? (
        <div className="neo-panel p-10 text-center">
          <p className="text-sm font-semibold tracking-[0.2em] text-black/70 uppercase dark:text-[hsl(var(--foreground))]">
            Browse
          </p>
          <h2 className="mt-3 text-3xl font-bold">
            No diagrams match these filters
          </h2>
          <p className="mt-4 text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Try a broader search or lower the minimum star filter.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-base text-[hsl(var(--neo-soft-text))] lg:text-sm dark:text-neutral-300">
              Showing {showingStart}-{showingEnd} of{" "}
              {starCountFormatter.format(result.total)} public diagrams
            </p>
          </div>

          <div className="neo-panel overflow-hidden rounded-lg">
            <div className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] px-4 py-3 text-left text-xs font-semibold tracking-[0.18em] uppercase lg:hidden dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
              Repository Results
            </div>
            <table className="w-full border-collapse lg:table-fixed">
              <colgroup className="hidden lg:table-column-group">
                <col />
                <col className="w-[104px]" />
                <col className="w-[188px] xl:w-[220px]" />
                <col className="w-[280px] xl:w-[304px]" />
              </colgroup>
              <thead className="hidden lg:table-header-group">
                <tr className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] text-left text-sm tracking-[0.16em] uppercase dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
                  <th className="px-5 py-4 font-semibold">Repository</th>
                  <th className="hidden px-5 py-4 font-semibold lg:table-cell lg:w-[104px]">
                    Stars
                  </th>
                  <th className="w-[188px] px-5 py-4 font-semibold lg:w-[188px] xl:w-[220px]">
                    Last Generated
                  </th>
                  <th className="w-[280px] px-5 py-4 font-semibold lg:pr-6 xl:w-[304px] xl:pr-7">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="block lg:table-row-group">
                {result.items.map((item) => {
                  const diagramPath = `/${encodeURIComponent(item.username)}/${encodeURIComponent(item.repo)}`;
                  const githubPath = `https://github.com/${item.username}/${item.repo}`;

                  return (
                    <tr
                      key={`${item.username}/${item.repo}`}
                      className="block border-b border-black/15 align-middle last:border-b-0 lg:table-row dark:border-white/10"
                    >
                      <td className="block px-4 pt-5 lg:table-cell lg:px-5 lg:py-4">
                        <Link
                          href={diagramPath}
                          title={`${item.username}/${item.repo}`}
                          className="block text-[1.4rem] leading-[1.05] font-semibold tracking-tight break-all hover:underline lg:overflow-hidden lg:text-lg lg:leading-tight lg:break-normal lg:text-ellipsis lg:whitespace-nowrap"
                        >
                          {item.username}/{item.repo}
                        </Link>
                        <p className="mt-3 lg:hidden">
                          <span className="inline-flex items-center rounded-full border-[2px] border-black bg-black/5 px-3 py-1 text-sm font-semibold dark:border-[#1a0d30] dark:bg-white/5">
                            {formatStarSummary(item.stargazerCount)}
                          </span>
                        </p>
                      </td>
                      <td className="hidden px-5 py-4 text-sm font-semibold whitespace-nowrap lg:table-cell">
                        {formatStarCount(item.stargazerCount)}
                      </td>
                      <td className="block px-4 pt-4 text-[hsl(var(--neo-soft-text))] lg:table-cell lg:px-5 lg:py-4 lg:text-sm dark:text-neutral-300">
                        <span className="block text-[11px] font-semibold tracking-[0.18em] text-[hsl(var(--neo-soft-text))] uppercase lg:hidden dark:text-neutral-400">
                          Last Generated
                        </span>
                        <time dateTime={item.lastSuccessfulAt}>
                          <span className="mt-2 block text-base leading-snug font-medium text-[hsl(var(--foreground))] lg:mt-0 lg:text-sm lg:font-normal lg:whitespace-nowrap lg:text-[hsl(var(--neo-soft-text))] dark:text-[hsl(var(--foreground))] lg:dark:text-neutral-300">
                            {formatGeneratedAt(item.lastSuccessfulAt)}
                          </span>
                        </time>
                      </td>
                      <td className="block px-4 py-4 lg:table-cell lg:px-5 lg:py-4 lg:pr-6 xl:px-6 xl:pr-7">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-center xl:flex xl:gap-3 xl:whitespace-nowrap">
                          <Link
                            href={diagramPath}
                            className="neo-button inline-flex min-h-[52px] w-full items-center justify-center rounded-md px-4 py-3 text-base font-semibold whitespace-nowrap lg:min-h-0 lg:min-w-0 lg:px-3 lg:py-2 lg:text-sm xl:w-auto xl:min-w-[148px] xl:px-4"
                          >
                            Open Diagram
                          </Link>
                          <Link
                            href={githubPath}
                            className="browse-muted-button inline-flex min-h-[52px] w-full items-center justify-center rounded-md px-4 py-3 text-base font-semibold whitespace-nowrap lg:min-h-0 lg:min-w-0 lg:px-3 lg:py-2 lg:text-sm xl:w-auto xl:min-w-[104px] xl:px-4"
                          >
                            GitHub
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base text-[hsl(var(--neo-soft-text))] lg:text-sm dark:text-neutral-300">
              Page {result.page} of {result.totalPages}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handlePageChange(result.page - 1)}
                disabled={!hasPreviousPage}
                className={`browse-muted-button inline-flex items-center rounded-md px-5 py-3 text-base font-semibold lg:px-4 lg:py-2 lg:text-sm ${
                  hasPreviousPage ? "" : "cursor-not-allowed opacity-50"
                }`}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(result.page + 1)}
                disabled={!hasNextPage}
                className={`inline-flex items-center rounded-md px-5 py-3 text-base font-semibold lg:px-4 lg:py-2 lg:text-sm ${
                  hasNextPage
                    ? "neo-button"
                    : "cursor-not-allowed border-[3px] border-black bg-[hsl(var(--neo-button))] opacity-50 dark:border-[#1a0d30]"
                }`}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
