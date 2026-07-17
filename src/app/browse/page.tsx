import type { Metadata } from "next";
import { Suspense } from "react";

import { getCachedBrowsePage } from "~/server/browse-index-cache";
import { BrowseCatalog } from "~/components/browse-catalog";
import { Skeleton } from "~/components/ui/skeleton";
import type { BrowseQuery } from "~/features/browse/catalog";

export const metadata: Metadata = {
  title: "Browse Diagrams | GitDiagram",
  description:
    "Browse all public repositories with stored diagrams, sorted by recency or stars.",
  alternates: {
    canonical: "/browse",
  },
};

export const dynamic = "force-dynamic";

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function BrowseCatalogStreamingFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="neo-panel grid gap-4 rounded-lg p-5 md:grid-cols-[minmax(0,1fr)_220px_180px] md:gap-5 md:p-6">
        <Skeleton className="h-[82px] w-full" />
        <Skeleton className="h-[82px] w-full" />
        <Skeleton className="h-[82px] w-full" />
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

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialQuery: BrowseQuery = {
    q: firstSearchParam(params.q),
    sort: firstSearchParam(params.sort),
    minStars: firstSearchParam(params.minStars),
    page: firstSearchParam(params.page),
  };
  return (
    <main className="px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <section className="mb-6 max-w-3xl sm:mb-8">
          <h1 className="max-w-[11ch] text-[clamp(2.9rem,12vw,4rem)] leading-[0.92] font-bold tracking-[-0.05em] text-balance sm:max-w-none sm:text-5xl sm:tracking-tight">
            Browse stored repository diagrams
          </h1>
          <p className="mt-4 max-w-[34rem] text-lg leading-[1.45] text-pretty text-[hsl(var(--neo-soft-text))] sm:mt-3 sm:text-base sm:leading-normal dark:text-neutral-300">
            Scan the full public diagram catalog by repository name, stars, and
            generation time.
          </p>
        </section>

        <Suspense fallback={<BrowseCatalogStreamingFallback />}>
          <BrowseCatalogWithInitialData initialQuery={initialQuery} />
        </Suspense>
      </div>
    </main>
  );
}
