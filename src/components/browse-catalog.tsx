"use client";

import { useEffect, useRef, useState } from "react";

import {
  normalizeBrowseQuery,
  parseBrowseQueryFromSearchParams,
} from "~/features/browse/catalog";
import type {
  BrowsePageResult,
  BrowseQuery,
  BrowseSort,
} from "~/features/browse/catalog";
import {
  getBrowsePageUrl,
  loadBrowsePage,
} from "~/features/browse/index-client";
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
  initialResult?: BrowsePageResult;
  initialPreviewDiagrams?: Record<string, string>;
  initialQuery: BrowseQuery;
}

const SLOW_RESULTS_INDICATOR_DELAY_MS = 5000;
const SEARCH_DEBOUNCE_MS = 150;

interface BrowseLoadState {
  error: string | null;
  isLoaded: boolean;
  result: BrowsePageResult | null;
  showSlowIndicator: boolean;
}

export function BrowseCatalog({
  initialResult,
  initialPreviewDiagrams,
  initialQuery,
}: BrowseCatalogProps) {
  const normalizedInitialQuery = normalizeBrowseQuery(initialQuery);
  const [loadState, setLoadState] = useState<BrowseLoadState>({
    error: null,
    isLoaded: Boolean(initialResult),
    result: initialResult ?? null,
    showSlowIndicator: false,
  });
  const [isQueryReady, setIsQueryReady] = useState(false);
  const [query, setQuery] = useState(normalizedInitialQuery);
  const {
    error: loadError,
    isLoaded,
    result,
    showSlowIndicator: showSlowResultsIndicator,
  } = loadState;
  const { q: searchInput, sort, minStars, page } = query;
  const activeRequestId = useRef(0);
  const settledSearchRef = useRef(normalizedInitialQuery.q);
  const loadedQueryKeyRef = useRef<string | null>(
    initialResult ? getBrowsePageUrl(initialQuery) : null,
  );
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
      setQuery(urlState);
      setIsQueryReady(true);
      return;
    }

    if (!isHistoryTraversalNavigation()) {
      setIsQueryReady(true);
      return;
    }

    const restoredState = readPersistedBrowseState();
    if (!restoredState) {
      setIsQueryReady(true);
      return;
    }

    setQuery(restoredState);
    syncBrowseUrl(restoredState, "replace");
    setIsQueryReady(true);
  }, []);

  useEffect(() => {
    if (!isQueryReady) {
      return;
    }

    persistBrowseState({
      ...query,
      q: query.q.trim(),
    });
  }, [isQueryReady, query]);

  useEffect(() => {
    if (!isQueryReady) {
      return;
    }

    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;
    const abortController = new AbortController();
    let slowIndicatorTimeoutId: number | null = null;
    const debounceDelay =
      searchInput === settledSearchRef.current ? 0 : SEARCH_DEBOUNCE_MS;
    const requestTimeoutId = window.setTimeout(() => {
      settledSearchRef.current = searchInput;
      const requestQuery = {
        page,
        q: searchInput,
        sort,
        minStars,
      };
      const queryKey = getBrowsePageUrl(requestQuery);

      if (loadedQueryKeyRef.current === queryKey) {
        setLoadState((current) => ({
          ...current,
          error: null,
          isLoaded: true,
          showSlowIndicator: false,
        }));
        return;
      }

      setLoadState((current) => ({
        ...current,
        error: null,
        isLoaded: false,
        showSlowIndicator: false,
      }));

      slowIndicatorTimeoutId = window.setTimeout(() => {
        if (activeRequestId.current === requestId) {
          setLoadState((current) => ({
            ...current,
            showSlowIndicator: true,
          }));
        }
      }, SLOW_RESULTS_INDICATOR_DELAY_MS);

      loadBrowsePage(requestQuery, abortController.signal)
        .then((loadedResult) => {
          if (activeRequestId.current !== requestId) {
            return;
          }

          if (slowIndicatorTimeoutId !== null) {
            window.clearTimeout(slowIndicatorTimeoutId);
          }
          loadedQueryKeyRef.current = queryKey;
          setLoadState({
            error: null,
            isLoaded: true,
            result: loadedResult,
            showSlowIndicator: false,
          });
        })
        .catch((error: unknown) => {
          if (
            activeRequestId.current !== requestId ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            return;
          }

          if (slowIndicatorTimeoutId !== null) {
            window.clearTimeout(slowIndicatorTimeoutId);
          }
          setLoadState((current) => ({
            ...current,
            error:
              error instanceof Error
                ? error.message
                : "Failed to load browse index.",
            isLoaded: true,
            showSlowIndicator: false,
          }));
        });
    }, debounceDelay);

    return () => {
      window.clearTimeout(requestTimeoutId);
      if (slowIndicatorTimeoutId !== null) {
        window.clearTimeout(slowIndicatorTimeoutId);
      }
      abortController.abort();
    };
  }, [isQueryReady, minStars, page, searchInput, sort]);

  useEffect(() => {
    const handlePopState = () => {
      const nextState = parseBrowseQueryFromSearchParams(
        new URLSearchParams(window.location.search),
      );

      setQuery(nextState);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const updateQuery = (
    patch: Partial<ReturnType<typeof normalizeBrowseQuery>>,
    historyMode: "push" | "replace",
  ) => {
    const nextQuery = {
      ...query,
      ...patch,
    };
    setQuery(nextQuery);
    syncBrowseUrl(
      {
        ...nextQuery,
        q: nextQuery.q.trim(),
      },
      historyMode,
    );
  };

  const handleSearchChange = (value: string) => {
    updateQuery({ page: 1, q: value }, "replace");
  };

  const handleSortChange = (value: BrowseSort) => {
    updateQuery({ page: 1, sort: value }, "replace");
  };

  const handleMinStarsChange = (value: number) => {
    updateQuery({ minStars: value, page: 1 }, "replace");
  };

  const handlePageChange = (nextPage: number) => {
    updateQuery({ page: nextPage }, "push");
  };

  if (loadError || (isLoaded && result === null)) {
    return (
      <div className="neo-panel p-8">
        <p className="text-sm font-semibold tracking-[0.2em] text-black/70 uppercase dark:text-[hsl(var(--foreground))]">
          Browse
        </p>
        <h2 className="mt-3 text-3xl font-bold">Browse index unavailable</h2>
        <p className="mt-4 max-w-3xl text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
          {loadError ??
            "This page reads only the hosted browse index. The index is currently unavailable in storage."}
        </p>
      </div>
    );
  }

  if (result === null) {
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

      {showSlowResultsIndicator && !isLoaded ? (
        <p className="text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
          Updating results...
        </p>
      ) : null}

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
