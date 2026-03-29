import type { Metadata } from "next";
import { BrowseCatalog } from "~/components/browse-catalog";
import {
  BrowseIndexNotFoundError,
  getBrowsePage,
} from "~/server/storage/browse-diagrams";

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
};

function getSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const resolvedSearchParams = await searchParams;
  let result;
  let browseIndexMissing = false;

  try {
    result = await getBrowsePage({
      q: getSingleValue(resolvedSearchParams.q),
      sort: getSingleValue(resolvedSearchParams.sort),
      minStars: getSingleValue(resolvedSearchParams.minStars),
      page: getSingleValue(resolvedSearchParams.page),
    });
  } catch (error) {
    if (!(error instanceof BrowseIndexNotFoundError)) {
      throw error;
    }
    browseIndexMissing = true;
  }

  if (browseIndexMissing || !result) {
    return (
      <main className="px-4 py-8 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <section className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[hsl(var(--neo-link))] dark:text-[hsl(var(--neo-link-hover))]">
              Browse
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              Browse index unavailable
            </h1>
            <p className="mt-4 max-w-3xl text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              This page reads only the hosted browse index. Run the backfill to
              create it, then refresh this page.
            </p>
          </section>

          <div className="neo-panel p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              Required Action
            </p>
            <p className="mt-4 text-base">
              Run <code>pnpm browse:backfill</code> in the environment that has
              access to the production R2 bucket.
            </p>
            <p className="mt-3 text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              Once the index exists, Browse will load directly from that JSON
              and stay up to date with each new public diagram generation.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <section className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[hsl(var(--neo-link))] dark:text-[hsl(var(--neo-link-hover))]">
            Browse
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Browse stored repository diagrams
          </h1>
          <p className="mt-4 max-w-3xl text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Scan the full public diagram catalog by repository name, stars, and
            generation time. The list defaults to the most recent repositories
            and stays fast by reading a cached browse index.
          </p>
        </section>

        <BrowseCatalog result={result} />
      </div>
    </main>
  );
}
