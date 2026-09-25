import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";
import { getGitHubApiHeaders } from "~/server/github-auth";

// PostHog stops API queries after 10 seconds of execution. The 30-day query
// scans a bounded window and refreshes hourly; the lifetime query scans all
// history, so it refreshes daily. Both windows end on a rounded cutoff, so
// repeated refreshes send identical queries that PostHog can answer from its
// own cache. A failed refresh keeps serving the last success.
const RECENT_CACHE_SECONDS = 60 * 60;
const LIFETIME_CACHE_SECONDS = 24 * 60 * 60;
const count = z.number().int().nonnegative();
const recentResponse = z.object({
  results: z
    .array(z.tuple([count, count, count, count, count, count]))
    .length(1),
});
const lifetimeResponse = z.object({
  results: z.array(z.tuple([count, count, count])).length(1),
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

const pageviews = `event = '$pageview'
      AND properties.$host IN ('gitdiagram.com', 'www.gitdiagram.com')`;

function posthogCredentials() {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim() || "113380";
  if (!apiKey || !/^\d+$/.test(projectId)) {
    throw new Error("Sponsor analytics credentials are not configured.");
  }
  return { apiKey, projectId };
}

async function queryPostHog(name: string, query: string) {
  const { apiKey, projectId } = posthogCredentials();
  const response = await fetch(
    `https://us.posthog.com/api/projects/${projectId}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query },
        // Reuses PostHog's cached result for an identical query.
        refresh: "blocking",
        name,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Sponsor analytics refresh failed (${response.status}).`);
  }
  return (await response.json()) as unknown;
}

// Floors the current time to a whole number of seconds `step`.
const cutoffAt = (step: number) => Math.floor(Date.now() / 1000 / step) * step;

async function refreshRecentStats() {
  posthogCredentials(); // Fail before any request when misconfigured.
  const cutoff = cutoffAt(60 * 60);
  const end = `toDateTime(${cutoff}, 'UTC')`;
  const repo =
    "match(properties.$pathname, '^/[^/]+/[^/]+/?$') AND NOT match(properties.$pathname, '^/(api|dev|auth|browse)/')";
  const query = `SELECT
    count(),
    uniqExact(distinct_id),
    uniqExactIf(distinct_id, ${repo}),
    countIf(${repo}),
    countIf(properties.$pathname = '/'),
    countIf(properties.$pathname = '/browse')
    FROM events
    WHERE ${pageviews}
      AND timestamp >= ${end} - INTERVAL 30 DAY
      AND timestamp < ${end}`;

  const [posthog, github] = await Promise.all([
    queryPostHog("sponsor-stats-30-days", query),
    getGitHubApiHeaders()
      .then((headers) =>
        fetch("https://api.github.com/repos/ahmedkhaleel2004/gitdiagram", {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        }),
      )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Sponsor GitHub refresh failed (${response.status}).`,
          );
        }
        return (await response.json()) as unknown;
      }),
  ]);
  const [
    monthlyPageviews,
    monthlyVisitors,
    repoVisitors,
    repoPageviews,
    homePageviews,
    browsePageviews,
  ] = recentResponse.parse(posthog).results[0]!;
  const { stargazers_count: githubStars } = githubResponse.parse(github);

  if (
    monthlyVisitors > monthlyPageviews ||
    repoVisitors > monthlyVisitors ||
    repoPageviews + homePageviews + browsePageviews > monthlyPageviews
  ) {
    throw new Error("Sponsor analytics returned inconsistent totals.");
  }

  return {
    asOf: new Date(cutoff * 1000).toISOString(),
    monthlyVisitors,
    monthlyPageviews,
    repoVisitors,
    repoPageviews,
    homePageviews,
    browsePageviews,
    githubStars,
  };
}

async function refreshLifetimeStats() {
  posthogCredentials();
  const cutoff = cutoffAt(24 * 60 * 60);
  const query = `SELECT
    count(),
    uniqExact(distinct_id),
    toUnixTimestamp(min(timestamp))
    FROM events
    WHERE ${pageviews}
      AND timestamp < toDateTime(${cutoff}, 'UTC')`;
  const [lifetimePageviews, lifetimeVisitors, firstEvent] =
    lifetimeResponse.parse(await queryPostHog("sponsor-stats-lifetime", query))
      .results[0]!;

  if (
    lifetimeVisitors > lifetimePageviews ||
    firstEvent <= 0 ||
    firstEvent > cutoff
  ) {
    throw new Error("Sponsor analytics returned inconsistent totals.");
  }

  return {
    trackedSince: new Date(firstEvent * 1000).toISOString(),
    lifetimeVisitors,
    lifetimePageviews,
  };
}

// Throw inside the cache callbacks on failure so Next keeps the last success.
const readRecentStats = unstable_cache(
  refreshRecentStats,
  ["sponsor-stats-recent-v2"],
  { revalidate: RECENT_CACHE_SECONDS },
);
const readLifetimeStats = unstable_cache(
  refreshLifetimeStats,
  ["sponsor-stats-lifetime-v2"],
  { revalidate: LIFETIME_CACHE_SECONDS },
);

export async function getSponsorStats(): Promise<SponsorStats> {
  if (!process.env.POSTHOG_PERSONAL_API_KEY?.trim()) {
    return VERIFIED_SNAPSHOT;
  }

  try {
    const [recent, lifetime] = await Promise.all([
      readRecentStats(),
      readLifetimeStats(),
    ]);
    // Lifetime totals end at the start of the UTC day, up to a day before the
    // 30-day window ends, but still far exceed it; a smaller one is bad data.
    if (
      recent.monthlyVisitors > lifetime.lifetimeVisitors ||
      recent.monthlyPageviews > lifetime.lifetimePageviews
    ) {
      throw new Error("Sponsor analytics returned inconsistent totals.");
    }
    return { ...recent, ...lifetime };
  } catch {
    console.warn(
      "Sponsor analytics unavailable; serving the dated fallback snapshot.",
    );
    return VERIFIED_SNAPSHOT;
  }
}
