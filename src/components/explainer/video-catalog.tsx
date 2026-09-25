"use client";

import { useEffect, useRef, useState } from "react";

import { BrowseCatalogControls } from "~/components/browse-catalog-controls";
import { BrowseCatalogPagination } from "~/components/browse-catalog-pagination";
import { VideoGrid } from "~/components/explainer/video-grid";
import {
  buildBrowseHref,
  buildBrowseSearchParams,
  normalizeBrowseQuery,
  parseBrowseQueryFromSearchParams,
} from "~/features/browse/catalog";
import type { BrowseSort } from "~/features/browse/catalog";
import type { VideoPage } from "~/features/explainer/catalog-types";

type VideoQuery = ReturnType<typeof normalizeBrowseQuery>;

const SEARCH_DEBOUNCE_MS = 150;
const totalCountFormatter = new Intl.NumberFormat("en");

function readUrlQuery() {
  return parseBrowseQueryFromSearchParams(
    new URLSearchParams(window.location.search),
  );
}

/** The query's search parameters: its URL on /videos and the API alike. */
const queryKey = (query: VideoQuery) =>
  buildBrowseSearchParams({ ...query, q: query.q.trim() }).toString();

async function loadVideoPage(
  key: string,
  signal: AbortSignal,
): Promise<VideoPage> {
  const response = await fetch(
    key ? `/api/video/catalog?${key}` : "/api/video/catalog",
    { credentials: "omit", signal },
  );
  if (!response.ok) throw new Error("The videos could not be loaded.");
  return (await response.json()) as VideoPage;
}

/**
 * The /videos gallery with the same search, sort and star filter as /browse.
 * The page arrives with its first page of videos; every other page is asked
 * for from the server, so the browser never holds the whole catalog.
 */
export function VideoCatalog({ initial }: { initial: VideoPage }) {
  const [query, setQuery] = useState<VideoQuery>(() =>
    normalizeBrowseQuery({}),
  );
  const [loaded, setLoaded] = useState<{ key: string; page: VideoPage } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const pages = useRef(new Map<string, VideoPage>());
  const settledSearch = useRef("");
  const topRef = useRef<HTMLDivElement>(null);

  // The page is statically rendered, so the URL is read after hydration.
  useEffect(() => {
    if (window.location.search) setQuery(readUrlQuery());
    const handlePopState = () => setQuery(readUrlQuery());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const key = queryKey(query);
  useEffect(() => {
    setError(false);
    // The first page came with the page itself.
    if (!key) return;
    const known = pages.current.get(key);
    if (known) {
      setLoaded({ key, page: known });
      return;
    }
    const controller = new AbortController();
    // Typing a search waits for a pause; paging and filters go at once.
    const delay = query.q === settledSearch.current ? 0 : SEARCH_DEBOUNCE_MS;
    const timer = window.setTimeout(() => {
      settledSearch.current = query.q;
      loadVideoPage(key, controller.signal)
        .then((page) => {
          pages.current.set(key, page);
          setLoaded({ key, page });
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, query.q]);

  if (!initial.total) return <VideoGrid cards={[]} />;

  // What to show: this query's page once it is here, else the last one.
  const result = !key ? initial : (loaded?.page ?? initial);
  const loading = Boolean(key) && loaded?.key !== key && !error;

  const updateQuery = (
    patch: Partial<VideoQuery>,
    historyMode: "push" | "replace",
  ) => {
    const nextQuery = { ...query, ...patch };
    setQuery(nextQuery);
    const href = buildBrowseHref(
      { ...nextQuery, q: nextQuery.q.trim() },
      "/videos",
    );
    if (historyMode === "push") window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
  };

  const handlePageChange = (nextPage: number) => {
    updateQuery({ page: nextPage }, "push");
    const top = topRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollTo({ top: window.scrollY + top - 16 });
  };

  const showingStart =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingEnd = Math.min(result.total, result.page * result.pageSize);

  return (
    <div ref={topRef} aria-busy={loading} className="space-y-4 sm:space-y-6">
      <BrowseCatalogControls
        minStars={query.minStars}
        onMinStarsChange={(value) =>
          updateQuery({ minStars: value, page: 1 }, "replace")
        }
        onSearchChange={(value) =>
          updateQuery({ page: 1, q: value }, "replace")
        }
        onSortChange={(value: BrowseSort) =>
          updateQuery({ page: 1, sort: value }, "replace")
        }
        searchInput={query.q}
        sort={query.sort}
      />

      {error ? (
        <div
          role="alert"
          className="neo-panel rounded-lg px-5 py-8 text-center sm:p-10"
        >
          <h2 className="text-2xl font-bold sm:text-3xl">
            The videos could not be loaded
          </h2>
          <p className="mt-4 text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Try again in a moment.
          </p>
        </div>
      ) : !loading && result.total === 0 ? (
        <div className="neo-panel rounded-lg px-5 py-8 text-center sm:p-10">
          <p className="text-sm font-semibold tracking-[0.2em] text-black/70 uppercase dark:text-[hsl(var(--foreground))]">
            Watch
          </p>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">
            No videos match these filters
          </h2>
          <p className="mt-4 text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Try a broader search or lower the minimum star filter.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            {showingStart}–{showingEnd} of{" "}
            {totalCountFormatter.format(result.total)} videos
          </p>
          <VideoGrid cards={result.cards} />
          <BrowseCatalogPagination
            onPageChange={handlePageChange}
            page={result.page}
            totalPages={result.totalPages}
          />
        </>
      )}
    </div>
  );
}
