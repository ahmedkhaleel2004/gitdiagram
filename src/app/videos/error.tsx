"use client";

import { BrowseTabs } from "~/components/browse-tabs";

/**
 * Shown when the gallery cannot be read and there is no earlier copy of the
 * page to show instead (a revalidation that fails keeps the last good one).
 */
export default function VideosError({ retry }: { retry: () => void }) {
  return (
    <main className="px-4 pt-5 pb-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <section className="mb-6 max-w-3xl sm:mb-9">
          <BrowseTabs active="videos" />
          <h1 className="text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl">
            Repos, explained in a minute
          </h1>
        </section>
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
          <button
            type="button"
            onClick={() => retry()}
            className="neo-button mt-6 inline-flex min-h-[44px] items-center rounded-md px-4 py-2 text-sm font-semibold"
          >
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
