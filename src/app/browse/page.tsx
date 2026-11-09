import type { Metadata } from "next";
import { Suspense } from "react";

import { getCachedBrowsePage } from "~/server/browse-index-cache";
import { BrowseCatalog } from "~/components/browse-catalog";
import { BrowseTabs } from "~/components/browse-tabs";
import { Skeleton } from "~/components/ui/skeleton";
import {
  normalizeBrowseQuery,
  type BrowseQuery,
} from "~/features/browse/catalog";

type BrowsePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const DESCRIPTION =
  "Browse all public repositories with stored diagrams, sorted by recency or stars.";

/**
 * Plain pages of the newest diagrams (`?page=2`) are their own canonical, so
 * search engines follow their links to every repository page (Previous and
 * Next are links). Searches, filters and other sorts point at /browse.
 */
export async function generateMetadata({
  searchParams,
}: BrowsePageProps): Promise<Metadata> {
  const params = await searchParams;
  const query = normalizeBrowseQuery({
    q: firstSearchParam(params.q),
    sort: firstSearchParam(params.sort),
    minStars: firstSearchParam(params.minStars),
    page: firstSearchParam(params.page),
  });
  const plainPage =
    !query.q && query.sort === "recent_desc" && query.minStars === 0
      ? query.page
      : 1;
  return {
    title:
      plainPage > 1
        ? `Browse Diagrams, page ${plainPage} | GitDiagram`
        : "Browse Diagrams | GitDiagram",
    description: DESCRIPTION,
    alternates: {
      canonical: plainPage > 1 ? `/browse?page=${plainPage}` : "/browse",
    },
  };
}

export const dynamic = "force-dynamic";

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function BrowseCatalogStreamingFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="neo-panel grid grid-cols-2 gap-4 rounded-lg p-4 md:grid-cols-[minmax(0,1fr)_220px_180px] md:gap-5 md:p-6">
        <Skeleton className="h-[74px] w-full first:col-span-2 md:first:col-span-1" />
        <Skeleton className="h-[74px] w-full first:col-span-2 md:first:col-span-1" />
        <Skeleton className="h-[74px] w-full first:col-span-2 md:first:col-span-1" />
      </div>
      <div className="neo-panel space-y-3 rounded-lg p-5">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

async function BrowseCatalogWithInitialData({
  initialQuery,
}: {
  initialQuery: BrowseQuery;
}) {
  const initialResult = await getCachedBrowsePage(initialQuery).catch(
    () => null,
  );

  return (
    <BrowseCatalog
      initialQuery={initialQuery}
      initialResult={initialResult ?? undefined}
    />
  );
}

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const params = await searchParams;
  const initialQuery: BrowseQuery = {
    q: firstSearchParam(params.q),
    sort: firstSearchParam(params.sort),
    minStars: firstSearchParam(params.minStars),
    page: firstSearchParam(params.page),
  };
  return (
    <main className="px-4 pt-5 pb-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <section className="mb-5 max-w-3xl sm:mb-8">
          <BrowseTabs active="diagrams" />
          <h1 className="text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl">
            Browse diagrams
          </h1>
          <p className="mt-3 max-w-[34rem] text-base leading-relaxed text-pretty text-[hsl(var(--neo-soft-text))] sm:leading-normal dark:text-neutral-300">
            Explore public repositories, one diagram at a time.
          </p>
        </section>

        <Suspense fallback={<BrowseCatalogStreamingFallback />}>
          <BrowseCatalogWithInitialData initialQuery={initialQuery} />
        </Suspense>
      </div>
    </main>
  );
}
