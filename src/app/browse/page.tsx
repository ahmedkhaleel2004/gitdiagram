import type { Metadata } from "next";

import {
  getCachedDefaultBrowsePreviewDiagrams,
} from "~/app/browse/data";
import { BrowseCatalog } from "~/components/browse-catalog";
import { normalizeBrowseQuery } from "~/features/browse/catalog";

type BrowsePageProps = {
  searchParams: Promise<{
    q?: string | string[];
    sort?: string | string[];
    minStars?: string | string[];
    page?: string | string[];
  }>;
};

export const metadata: Metadata = {
  title: "Browse Diagrams | GitDiagram",
  description:
    "Browse all public repositories with stored diagrams, sorted by recency or stars.",
  alternates: {
    canonical: "/browse",
  },
};

function getSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const resolvedSearchParams = await searchParams;
  const initialQuery = {
    q: getSingleValue(resolvedSearchParams.q),
    sort: getSingleValue(resolvedSearchParams.sort),
    minStars: getSingleValue(resolvedSearchParams.minStars),
    page: getSingleValue(resolvedSearchParams.page),
  };
  const normalizedInitialQuery = normalizeBrowseQuery(initialQuery);
  const shouldPreloadDefaultPreviews =
    normalizedInitialQuery.q === "" &&
    normalizedInitialQuery.sort === "recent_desc" &&
    normalizedInitialQuery.minStars === 0 &&
    normalizedInitialQuery.page === 1;
  const initialPreviewDiagrams = shouldPreloadDefaultPreviews
    ? await getCachedDefaultBrowsePreviewDiagrams()
    : undefined;

  return (
    <main className="px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <section className="mb-6 max-w-3xl sm:mb-8">
          <h1 className="max-w-[11ch] text-[clamp(2.9rem,12vw,4rem)] leading-[0.92] font-bold tracking-[-0.05em] text-balance sm:max-w-none sm:text-5xl sm:tracking-tight">
            Browse stored repository diagrams
          </h1>
          <p className="mt-4 max-w-[34rem] text-lg leading-[1.45] text-pretty text-[hsl(var(--neo-soft-text))] sm:mt-3 sm:text-base sm:leading-normal dark:text-neutral-300">
            Scan the full public diagram catalog by repository name, stars, and
            generation time. The list defaults to the most recent repositories
            and stays fast by reading a cached browse index.
          </p>
        </section>

        <BrowseCatalog
          initialPreviewDiagrams={initialPreviewDiagrams}
          initialQuery={initialQuery}
        />
      </div>
    </main>
  );
}
