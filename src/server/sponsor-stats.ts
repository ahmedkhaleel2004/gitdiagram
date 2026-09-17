import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";
import { getGitHubApiHeaders } from "~/server/github-auth";

const CACHE_SECONDS = 5 * 60;
const count = z.number().int().nonnegative();
const posthogResponse = z.object({
  results: z
    .array(
      z.tuple([count, count, count, count, count, count, count, count, count]),
    )
    .length(1),
});
const githubResponse = z.object({ stargazers_count: count });

export type SponsorStats = {
  asOf: string;
  trackedSince: string;
  lifetimeVisitors: number;
  lifetimePageviews: number;
  monthlyVisitors: number;
  monthlyPageviews: number;
  repoVisitors: number;
  repoPageviews: number;
  homePageviews: number;
  browsePageviews: number;
  githubStars: number;
};

// A dated, verified snapshot keeps local builds and first-time outages usable.
// Never give fallback data a new timestamp or cache it as a successful refresh.
const VERIFIED_SNAPSHOT: SponsorStats = {
  asOf: "2026-09-17T22:40:53.000Z",
  trackedSince: "2024-12-26T12:39:22.000Z",
  lifetimeVisitors: 366235,
  lifetimePageviews: 846732,
  monthlyVisitors: 31666,
  monthlyPageviews: 81385,
  repoVisitors: 27731,
  repoPageviews: 57536,
  homePageviews: 11605,
  browsePageviews: 8350,
  githubStars: 16178,
};

async function refreshSponsorStats(): Promise<SponsorStats> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim() || "113380";
  if (!apiKey || !/^\d+$/.test(projectId)) {
    throw new Error("Sponsor analytics credentials are not configured.");
  }

  const cutoff = Math.floor(Date.now() / 1000);
  const end = `toDateTime(${cutoff}, 'UTC')`;
  const monthly = `timestamp >= ${end} - INTERVAL 30 DAY`;
  const repo =
    "match(properties.$pathname, '^/[^/]+/[^/]+/?$') AND NOT match(properties.$pathname, '^/(api|dev|auth|browse)/')";
  const query = `SELECT
    count(),
    uniqExact(distinct_id),
    countIf(${monthly}),
    uniqExactIf(distinct_id, ${monthly}),
    uniqExactIf(distinct_id, (${monthly}) AND (${repo})),
    countIf((${monthly}) AND (${repo})),
    countIf((${monthly}) AND properties.$pathname = '/'),
    countIf((${monthly}) AND properties.$pathname = '/browse'),
    toUnixTimestamp(min(timestamp))
    FROM events
    WHERE event = '$pageview'
      AND properties.$host IN ('gitdiagram.com', 'www.gitdiagram.com')
      AND timestamp < ${end}`;

  const [posthog, github] = await Promise.all([
    fetch(`https://us.posthog.com/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query },
        refresh: "force_blocking",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    }),
    getGitHubApiHeaders().then((headers) =>
      fetch("https://api.github.com/repos/ahmedkhaleel2004/gitdiagram", {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }),
    ),
  ]);
  if (!posthog.ok || !github.ok) {
    throw new Error(
      `Sponsor analytics refresh failed (${posthog.status}, ${github.status}).`,
    );
  }

  const [posthogJson, githubJson] = await Promise.all([
    posthog.json() as Promise<unknown>,
    github.json() as Promise<unknown>,
  ]);
  const { results } = posthogResponse.parse(posthogJson);
  const { stargazers_count: githubStars } = githubResponse.parse(githubJson);
  const row = results[0]!;
  const [
    lifetimePageviews,
    lifetimeVisitors,
    monthlyPageviews,
    monthlyVisitors,
    repoVisitors,
    repoPageviews,
    homePageviews,
    browsePageviews,
    firstEvent,
  ] = row;

  if (
    monthlyVisitors > monthlyPageviews ||
    repoVisitors > monthlyVisitors ||
    monthlyVisitors > lifetimeVisitors ||
    monthlyPageviews > lifetimePageviews ||
    repoPageviews + homePageviews + browsePageviews > monthlyPageviews ||
    firstEvent <= 0 ||
    firstEvent > cutoff
  ) {
    throw new Error("Sponsor analytics returned inconsistent totals.");
  }

  return {
    asOf: new Date(cutoff * 1000).toISOString(),
    trackedSince: new Date(firstEvent * 1000).toISOString(),
    lifetimeVisitors,
    lifetimePageviews,
    monthlyVisitors,
    monthlyPageviews,
    repoVisitors,
    repoPageviews,
    homePageviews,
    browsePageviews,
    githubStars,
  };
}

const readCachedSponsorStats = unstable_cache(
  refreshSponsorStats,
  ["sponsor-stats-v1"],
  { revalidate: CACHE_SECONDS },
);

export async function getSponsorStats(): Promise<SponsorStats> {
  if (!process.env.POSTHOG_PERSONAL_API_KEY?.trim()) {
    return VERIFIED_SNAPSHOT;
  }

  try {
    // Throw inside the cache callback on failure so Next keeps its last success.
    return await readCachedSponsorStats();
  } catch {
    console.warn(
      "Sponsor analytics unavailable; serving the dated fallback snapshot.",
    );
    return VERIFIED_SNAPSHOT;
  }
}
