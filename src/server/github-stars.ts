import "server-only";

import { unstable_cache } from "next/cache";

import { getGitHubApiHeaders } from "./github-auth";

interface GitHubRepoResponse {
  stargazers_count: number;
}

const GITHUB_REPO_URL =
  "https://api.github.com/repos/ahmedkhaleel2004/gitdiagram";
// The header shows this on every page, and a page's cache lifetime is the
// shortest revalidate read while rendering it: at five minutes this capped
// every page (repository pages are meant to keep six hours) and made the
// platform re-render and re-store pages crawlers keep asking for (about a
// third of Vercel's ISR writes, Oct 2026). The count moves slowly; six hours
// matches the repository page, so it never shortens it.
const STAR_COUNT_REVALIDATE_SECONDS = 60 * 60 * 6;

// A page rendered without the count (GitHub refused or was slow) must not be
// kept for six hours: reading this short-lived entry caps that page at five
// minutes, like any page before the count's lifetime was raised.
const shortenPageLifetime = unstable_cache(
  async () => true,
  ["star-count-failure"],
  { revalidate: 60 * 5 },
);

// Never the GitHub App here: minting its token is an uncached fetch, and an
// uncached fetch while a page renders for the cache fails that page with
// "Page changed from static to dynamic at runtime" (tried 2026-10-02: repository
// pages answered 500 whenever the anonymous call was refused).
export async function getStarCount() {
  try {
    const response = await fetch(GITHUB_REPO_URL, {
      cache: "force-cache",
      headers: await getGitHubApiHeaders({ allowGitHubAppAuth: false }),
      next: {
        revalidate: STAR_COUNT_REVALIDATE_SECONDS,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch star count (${response.status})`);
    }

    const data = (await response.json()) as GitHubRepoResponse;
    return data.stargazers_count;
  } catch (error) {
    console.error("Error fetching GitHub star count:", error);
    await shortenPageLifetime().catch(() => undefined);
    return null;
  }
}
