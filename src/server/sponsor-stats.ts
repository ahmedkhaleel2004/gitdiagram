import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";
import { getGitHubApiHeaders } from "~/server/github-auth";

// PostHog stops API queries after 10 seconds of execution. The 30-day query
// scans a bounded window and refreshes hourly; the lifetime query scans all
// history, so it refreshes daily. Both windows end on a rounded cutoff, so
// repeated refreshes send identical queries that PostHog can answer from its
// own cache. A failed refresh keeps the last success in Next's cache; with
// none, the page says the figures could not be loaded (no stand-in numbers).
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

const queryStatus = z.object({
  query_status: z.object({
    id: z.string(),
    complete: z.boolean().optional(),
    error: z.boolean().optional(),
    error_message: z.string().nullish(),
    results: z.unknown().optional(),
  }),
});

// How long one refresh waits for a query PostHog runs in the background. A
// query still running after this keeps going on PostHog's side, and the next
// refresh picks up its cached result.
const ASYNC_POLL_MS = 1_500;
const ASYNC_POLLS = 13; // About 20 seconds.

async function postHogRequest(path: string, init: RequestInit = {}) {
  const { apiKey, projectId } = posthogCredentials();
  const response = await fetch(
    `https://us.posthog.com/api/projects/${projectId}/query/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Sponsor analytics refresh failed (${response.status}).`);
  }
  return (await response.json()) as unknown;
}

// Asks PostHog for its cached result, or starts the query in the background
// (no 10-second limit there, which the lifetime scan outgrew in October 2026)
// and waits for it.
async function queryPostHog(name: string, query: string) {
  const first = await postHogRequest("", {
    method: "POST",
    body: JSON.stringify({
      query: { kind: "HogQLQuery", query },
      // Reuses PostHog's cached result for an identical query.
      refresh: "async",
      name,
    }),
  });
  const pending = queryStatus.safeParse(first);
  if (!pending.success) return first;
  let status = pending.data.query_status;
  for (let poll = 0; !status.complete; poll++) {
    if (poll === ASYNC_POLLS) {
      throw new Error("Sponsor analytics query is still running.");
    }
    await new Promise((resolve) => setTimeout(resolve, ASYNC_POLL_MS));
    status = queryStatus.parse(
      await postHogRequest(`${encodeURIComponent(status.id)}/`),
    ).query_status;
  }
  if (status.error) {
    throw new Error(
      `Sponsor analytics query failed: ${status.error_message ?? "unknown"}`,
    );
  }
  return status.results;
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

  const [
    monthlyPageviews,
    monthlyVisitors,
    repoVisitors,
    repoPageviews,
    homePageviews,
    browsePageviews,
  ] = recentResponse.parse(await queryPostHog("sponsor-stats-30-days", query))
    .results[0]!;

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
  };
}

async function refreshGitHubStars() {
  const response = await fetch(
    "https://api.github.com/repos/ahmedkhaleel2004/gitdiagram",
    {
      headers: await getGitHubApiHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Sponsor GitHub refresh failed (${response.status}).`);
  }
  return githubResponse.parse(await response.json()).stargazers_count;
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
// Stars have their own cache, so a GitHub error or rate limit never discards
// good PostHog figures: it keeps the last star count.
const readGitHubStars = unstable_cache(
  refreshGitHubStars,
  ["sponsor-stats-stars-v1"],
  { revalidate: RECENT_CACHE_SECONDS },
);

// The live figures, or null with the reason logged.
export async function getSponsorStats(): Promise<SponsorStats | null> {
  const [recent, lifetime, stars] = await Promise.allSettled([
    readRecentStats(),
    readLifetimeStats(),
    readGitHubStars(),
  ]);
  const failures = [
    ["30-day figures", recent],
    ["lifetime totals", lifetime],
    ["GitHub stars", stars],
  ].flatMap(([what, result]) =>
    (result as PromiseSettledResult<unknown>).status === "rejected"
      ? [`${what}: ${describe((result as PromiseRejectedResult).reason)}`]
      : [],
  );
  if (
    recent.status === "rejected" ||
    lifetime.status === "rejected" ||
    stars.status === "rejected"
  ) {
    console.error("Sponsor stats unavailable.", failures.join("; "));
    return null;
  }
  // Lifetime totals end at the start of the UTC day, up to a day before the
  // 30-day window ends, but still far exceed it; a smaller one is bad data.
  if (
    recent.value.monthlyVisitors > lifetime.value.lifetimeVisitors ||
    recent.value.monthlyPageviews > lifetime.value.lifetimePageviews
  ) {
    console.error("Sponsor stats unavailable: inconsistent totals.");
    return null;
  }
  return { ...recent.value, ...lifetime.value, githubStars: stars.value };
}

function describe(error: unknown) {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
