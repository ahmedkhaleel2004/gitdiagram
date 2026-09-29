import type { Metadata } from "next";
import Link from "next/link";

import MainCard from "~/components/main-card";

export const placeholderRepoMetadata: Metadata = {
  title: "Replace user/repo with a repository | GitDiagram",
  description:
    "Swap the example user/repo in the address for any GitHub repository to see its architecture diagram.",
  robots: { index: false, follow: true },
};

/**
 * Shown for a copied example address such as /user/repo: explains the URL and
 * offers the home page's form. It never reads storage, GitHub or a model.
 */
export function PlaceholderRepo({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const typed = `${username}/${repo}`;
  return (
    <main className="flex min-h-[calc(100svh-9.75rem)] flex-col justify-center overflow-x-clip px-4 pt-6 pb-3 sm:block sm:min-h-0 sm:px-8 sm:py-8 md:p-8">
      <div className="mx-auto mb-6 max-w-4xl pt-4 sm:mb-10 sm:pt-0 lg:mt-8">
        <h1 className="text-center text-[clamp(2rem,9vw,3rem)] leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl">
          Swap{" "}
          <span className="text-purple-600 dark:text-[hsl(var(--neo-button))]">
            {typed}
          </span>{" "}
          for a real repository
        </h1>
        <div className="mx-auto mt-5 max-w-[22rem] space-y-3 text-center text-[1.0625rem] leading-6 text-balance text-[hsl(var(--neo-soft-text))] sm:mt-8 sm:max-w-2xl sm:text-lg sm:leading-normal">
          <p>
            <span className="font-semibold">{typed}</span> is the example
            address, not a repository. Put any GitHub repository in its place.
          </p>
          <p className="break-words">
            For example,{" "}
            <span className="font-mono text-[0.95em]">
              github.com/fastapi/fastapi
            </span>{" "}
            becomes{" "}
            <Link
              href="/fastapi/fastapi"
              className="font-mono text-[0.95em] font-semibold underline decoration-2 underline-offset-4"
            >
              gitdiagram.com/fastapi/fastapi
            </Link>
          </p>
        </div>
      </div>
      <div className="flex justify-center sm:mb-16 lg:mb-0">
        <MainCard sponsor={false} />
      </div>
    </main>
  );
}
