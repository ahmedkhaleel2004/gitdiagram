import type { Metadata } from "next";
import { BrowseCatalog } from "~/components/browse-catalog";

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

  return (
    <main className="px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <section className="mb-6 max-w-3xl sm:mb-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Browse stored repository diagrams
          </h1>
          <p className="mt-3 text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Scan the full public diagram catalog by repository name, stars, and
            generation time. The list defaults to the most recent repositories
            and stays fast by reading a cached browse index.
          </p>
        </section>

        <BrowseCatalog
          initialQuery={{
            q: getSingleValue(resolvedSearchParams.q),
            sort: getSingleValue(resolvedSearchParams.sort),
            minStars: getSingleValue(resolvedSearchParams.minStars),
            page: getSingleValue(resolvedSearchParams.page),
          }}
        />
      </div>
    </main>
  );
}
