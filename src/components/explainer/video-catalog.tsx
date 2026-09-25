"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { BrowseCatalogControls } from "~/components/browse-catalog-controls";
import { BrowseCatalogPagination } from "~/components/browse-catalog-pagination";
import { VideoGrid } from "~/components/explainer/video-grid";
import {
  buildBrowseHref,
  getBrowsePageFromEntries,
  normalizeBrowseQuery,
  parseBrowseQueryFromSearchParams,
} from "~/features/browse/catalog";
import type { BrowseSort } from "~/features/browse/catalog";
import type { VideoCard } from "~/server/explainer/catalog";

// Divides evenly into the grid's two, three and four columns.
export const VIDEO_PAGE_SIZE = 24;

type VideoQuery = ReturnType<typeof normalizeBrowseQuery>;

const totalCountFormatter = new Intl.NumberFormat("en");

function readUrlQuery() {
  return parseBrowseQueryFromSearchParams(
    new URLSearchParams(window.location.search),
  );
}

/** The /videos gallery with the same search, sort and star filter as /browse. */
export function VideoCatalog({ cards }: { cards: VideoCard[] }) {
  const [query, setQuery] = useState<VideoQuery>(() =>
    normalizeBrowseQuery({}),
  );
  const topRef = useRef<HTMLDivElement>(null);

  // The page is statically rendered, so the URL is read after hydration.
  useEffect(() => {
    if (window.location.search) setQuery(readUrlQuery());
    const handlePopState = () => setQuery(readUrlQuery());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Browse sorts and filters index entries; each one carries its card along.
  const entries = useMemo(
    () =>
      cards.map((card) => ({
        username: card.owner,
        repo: card.repo,
        lastSuccessfulAt: card.createdAt,
        stargazerCount: card.stars,
        card,
      })),
    [cards],
  );
  const result = useMemo(
    () => getBrowsePageFromEntries(entries, query, VIDEO_PAGE_SIZE),
    [entries, query],
  );

  if (!cards.length) return <VideoGrid cards={[]} />;

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
    <div ref={topRef} className="space-y-4 sm:space-y-6">
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

      {result.total === 0 ? (
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
          <VideoGrid cards={result.items.map((item) => item.card)} />
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
