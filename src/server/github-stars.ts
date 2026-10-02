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

async function fetchRepository(asGitHubApp: boolean) {
  return fetch(GITHUB_REPO_URL, {
    cache: "no-store",
    headers: await getGitHubApiHeaders({ allowGitHubAppAuth: asGitHubApp }),
    signal: AbortSignal.timeout(5_000),
  });
}

// The count, kept six hours in the data cache. The reads happen inside
// `unstable_cache` on purpose: an uncached fetch made directly while a page
// renders for the cache (minting the GitHub App's token is one) fails that
// page with "Page changed from static to dynamic at runtime", which is what
// a first attempt at the App fallback did to repository pages on 2026-10-02.
// A failed read throws, so nothing is kept and the next render tries again.
const readStarCount = unstable_cache(
  async () => {
    // Without credentials first, as always. GitHub allows 60 such calls an
    // hour per address, and Cloudflare Workers share their addresses with
    // other sites: there the call was refused (403 or 429) about once a
    // minute, against five times a day on Vercel. Then once as the GitHub App.
    let response = await fetchRepository(false);
    if (response.status === 403 || response.status === 429) {
      await response.body?.cancel();
      response = await fetchRepository(true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Failed to fetch star count (${response.status})`);
    }
    const data = (await response.json()) as GitHubRepoResponse;
    return data.stargazers_count;
  },
  ["github-star-count-v2"],
  { revalidate: STAR_COUNT_REVALIDATE_SECONDS },
);

export async function getStarCount() {
  try {
    return await readStarCount();
  } catch (error) {
    console.error("Error fetching GitHub star count:", error);
    await shortenPageLifetime().catch(() => undefined);
    return null;
  }
}
