"use client";

import { useDeferredValue, useEffect, useState } from "react";

import {
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
import { BrowseCatalogControls } from "~/components/browse-catalog-controls";
import { BrowseCatalogLoadingState } from "~/components/browse-catalog-loading-state";
import { BrowseCatalogResults } from "~/components/browse-catalog-results";
import {
  isHistoryTraversalNavigation,
  persistBrowseState,
  readPersistedBrowseState,
  syncBrowseUrl,
} from "~/components/browse-catalog-shared";
import { useBrowseHoverPreview } from "~/hooks/use-browse-hover-preview";

interface BrowseCatalogProps {
  entries?: BrowseIndexEntry[];
  initialPreviewDiagrams?: Record<string, string>;
  initialQuery: BrowseQuery;
}

export function BrowseCatalog({
  entries: initialEntries,
  initialPreviewDiagrams,
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
  const {
    closeHoverPreview,
    desktopHoverEnabled,
    handleRepoHoverMove,
    handleRepoHoverStart,
    hoverPreview,
    hoverPreviewDiagram,
    hoverPreviewElementRef,
    hoverPreviewStatus,
  } = useBrowseHoverPreview({
    initialPreviewDiagrams,
  });

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
        <BrowseCatalogResults
          closeHoverPreview={closeHoverPreview}
          desktopHoverEnabled={desktopHoverEnabled}
          handlePageChange={handlePageChange}
          handleRepoHoverMove={handleRepoHoverMove}
          handleRepoHoverStart={handleRepoHoverStart}
          hoverPreview={hoverPreview}
          hoverPreviewDiagram={hoverPreviewDiagram}
          hoverPreviewElementRef={hoverPreviewElementRef}
          hoverPreviewStatus={hoverPreviewStatus}
          result={result}
        />
      )}
    </div>
  );
}
