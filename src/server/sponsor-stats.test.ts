import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cacheState, cache, headers } = vi.hoisted(() => {
  const cacheState: {
    callback?: () => Promise<unknown>;
    keys?: string[];
    options?: { revalidate: number };
  } = {};
  return {
    cacheState,
    cache: (
      callback: () => Promise<unknown>,
      keys: string[],
      options: { revalidate: number },
    ) => {
      Object.assign(cacheState, { callback, keys, options });
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
const goodRow = [
  900000,
  380000,
  82000,
  32000,
  28000,
  58000,
  12000,
  8500,
  trackedSince,
];
const request = vi.fn<typeof fetch>();
function sources(row: unknown[] = goodRow, stars: unknown = 16200) {
  request.mockImplementation(async (url) =>
    String(url).includes("posthog.com")
      ? Response.json({ results: [row] })
      : Response.json({ stargazers_count: stars }),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", request);
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "test-query-key");
  vi.stubEnv("POSTHOG_PROJECT_ID", "113380");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-17T23:00:00Z"));
  request.mockReset();
  sources();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sponsor stats", () => {
  it("refreshes both sources in one five-minute cache with a UTC rolling window", async () => {
    const result = await getSponsorStats();
    expect(result).toMatchObject({
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
    expect(cacheState.keys).toEqual(["sponsor-stats-v1"]);
    expect(cacheState.options).toEqual({ revalidate: 300 });
    const options = request.mock.calls.find(([url]) =>
      String(url).includes("posthog.com"),
    )![1]!;
    const body = JSON.parse(options.body as string) as {
      query: { query: string };
      refresh: string;
    };
    expect(body.query.query).toContain(
      "timestamp < toDateTime(1789686000, 'UTC')",
    );
    expect(body.query.query).toContain(
      "timestamp >= toDateTime(1789686000, 'UTC') - INTERVAL 30 DAY",
    );
    expect(body.query.query).toContain(
      "properties.$host IN ('gitdiagram.com', 'www.gitdiagram.com')",
    );
    expect(body.refresh).toBe("force_blocking");
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
    const callback = cacheState.callback!;
    await expect(callback()).rejects.toThrow(
      "Sponsor analytics refresh failed",
    );
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
  });

  it("preserves a dated fallback if GitHub is rate limited", async () => {
    request.mockImplementation(async (url) =>
      String(url).includes("github.com")
        ? new Response(null, { status: 403 })
        : Response.json({ results: [goodRow] }),
    );
    expect((await getSponsorStats()).githubStars).toBe(16178);
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
  });

  it("rejects incomplete query responses instead of publishing zero metrics", async () => {
    sources([900000, 380000]);
    expect((await getSponsorStats()).monthlyVisitors).toBe(31666);
  });

  it("rejects inconsistent audience totals and invalid GitHub data", async () => {
    sources([
      900000,
      380000,
      100,
      32000,
      28000,
      58000,
      12000,
      8500,
      trackedSince,
    ]);
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
    sources(goodRow, "unknown");
    expect((await getSponsorStats()).asOf).toBe("2026-09-17T22:40:53.000Z");
  });

  it("does not send credentials to a malformed project URL", async () => {
    vi.stubEnv("POSTHOG_PROJECT_ID", "../other");
    await getSponsorStats();
    expect(request).not.toHaveBeenCalled();
  });
});
