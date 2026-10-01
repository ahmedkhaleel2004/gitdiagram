import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Shown for addresses that match no page, most often `/owner` without a
 * repository (a GitHub profile link with the domain swapped).
 */
export default function NotFound() {
  return (
    <main className="px-4 pt-5 pb-8 sm:px-8 sm:py-10">
      <div className="neo-panel mx-auto max-w-2xl rounded-lg px-5 py-8 text-center sm:p-10">
        <h1 className="text-2xl font-bold sm:text-3xl">
          This page does not exist
        </h1>
        <p className="mt-4 text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
          A diagram lives at gitdiagram.com/owner/repo, the same path as the
          repository on GitHub.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="neo-button inline-flex min-h-[44px] items-center rounded-md px-4 py-2 text-sm font-semibold"
          >
            Make a diagram
          </Link>
          <Link
            href="/browse"
            className="neo-button-muted inline-flex min-h-[44px] items-center rounded-md px-4 py-2 text-sm font-semibold"
          >
            Browse diagrams
          </Link>
        </div>
      </div>
    </main>
  );
}
