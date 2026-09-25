import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { caches, cache, headers } = vi.hoisted(() => {
  const caches = new Map<
    string,
    { callback: () => Promise<unknown>; options: { revalidate: number } }
  >();
  return {
    caches,
    cache: (
      callback: () => Promise<unknown>,
      keys: string[],
      options: { revalidate: number },
    ) => {
      caches.set(keys.join(), { callback, options });
      return callback;
    },
    headers: vi.fn(async () => ({ Accept: "application/vnd.github+json" })),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: cache }));
vi.mock("~/server/github-auth", () => ({ getGitHubApiHeaders: headers }));

import { getSponsorStats } from "~/server/sponsor-stats";

const trackedSince = Date.parse("2024-12-26T12:39:22Z") / 1000;
const recentRow = [82000, 32000, 28000, 58000, 12000, 8500];
const lifetimeRow = [900000, 380000, trackedSince];
const request = vi.fn<typeof fetch>();
type QueryBody = { query: { query: string }; refresh: string; name: string };
const queryBody = (name: string) =>
  request.mock.calls
    .map(([, init]) => init?.body)
    .filter((body): body is string => typeof body === "string")
    .map((body) => JSON.parse(body) as QueryBody)
    .find((body) => body.name === name)!;

function sources({
  recent = recentRow as unknown[],
  lifetime = lifetimeRow as unknown[],
  stars = 16200 as unknown,
} = {}) {
  request.mockImplementation(async (url, init) => {
    if (!String(url).includes("posthog.com"))
      return Response.json({ stargazers_count: stars });
    const { name } = JSON.parse(init!.body as string) as QueryBody;
    return Response.json({
      results: [name === "sponsor-stats-lifetime" ? lifetime : recent],
    });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", request);
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "test-query-key");
  vi.stubEnv("POSTHOG_PROJECT_ID", "113380");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-17T23:41:00Z"));
  request.mockReset();
  sources();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sponsor stats", () => {
  it("refreshes 30-day figures hourly and lifetime totals daily on rounded UTC cutoffs", async () => {
    const result = await getSponsorStats();
    expect(result).toEqual({
      asOf: "2026-09-17T23:00:00.000Z",
      trackedSince: "2024-12-26T12:39:22.000Z",
      monthlyVisitors: 32000,
      monthlyPageviews: 82000,
      lifetimeVisitors: 380000,
      lifetimePageviews: 900000,
      repoVisitors: 28000,
      repoPageviews: 58000,
      homePageviews: 12000,
      browsePageviews: 8500,
      githubStars: 16200,
    });
    expect([...caches].map(([key, { options }]) => [key, options])).toEqual([
      ["sponsor-stats-recent-v2", { revalidate: 3600 }],
      ["sponsor-stats-lifetime-v2", { revalidate: 86400 }],
    ]);
    const recent = queryBody("sponsor-stats-30-days");
    // 2026-09-17T23:00:00Z: the scan is bounded to the 30-day window.
    expect(recent.query.query).toContain(
      "timestamp >= toDateTime(1789686000, 'UTC') - INTERVAL 30 DAY",
    );
    expect(recent.query.query).toContain(
      "timestamp < toDateTime(1789686000, 'UTC')",
    );
    expect(recent.query.query).toContain(
      "properties.$host IN ('gitdiagram.com', 'www.gitdiagram.com')",
    );
    const lifetime = queryBody("sponsor-stats-lifetime");
    // 2026-09-17T00:00:00Z.
    expect(lifetime.query.query).toContain(
      "timestamp < toDateTime(1789603200, 'UTC')",
    );
    // No forced recomputation: PostHog may reuse its result for the same query.
    expect([recent.refresh, lifetime.refresh]).toEqual([
      "blocking",
      "blocking",
    ]);
    expect(JSON.stringify(result)).not.toContain("test-query-key");
  });

  it("keeps the verified timestamp when credentials are missing", async () => {
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
    const result = await getSponsorStats();
    expect(result.asOf).toBe("2026-09-17T22:40:53.000Z");
    expect(result.monthlyVisitors).toBe(31666);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not cache failed refreshes as new successful snapshots", async () => {
    request.mockResolvedValue(new Response(null, { status: 503 }));
    for (const { callback } of caches.values()) {
      await expect(callback()).rejects.toThrow("refresh failed");
    }
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
  });

  it("preserves a dated fallback if GitHub is rate limited", async () => {
    request.mockImplementation(async (url) =>
      String(url).includes("github.com")
        ? new Response(null, { status: 403 })
        : Response.json({ results: [recentRow] }),
    );
    expect((await getSponsorStats()).githubStars).toBe(16178);
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
  });

  it("rejects incomplete query responses instead of publishing zero metrics", async () => {
    sources({ recent: [82000, 32000] });
    expect((await getSponsorStats()).monthlyVisitors).toBe(31666);
    sources({ lifetime: [900000] });
    expect((await getSponsorStats()).monthlyVisitors).toBe(31666);
  });

  it("rejects inconsistent audience totals and invalid GitHub data", async () => {
    sources({ recent: [100, 32000, 28000, 58000, 12000, 8500] });
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
    sources({ lifetime: [900000, 20000, trackedSince] });
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
    sources({ lifetime: [900000, 380000, 0] });
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
    sources({ stars: "unknown" });
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
  });

  it("does not send credentials to a malformed project URL", async () => {
    vi.stubEnv("POSTHOG_PROJECT_ID", "../other");
    await getSponsorStats();
    expect(request).not.toHaveBeenCalled();
  });
});
