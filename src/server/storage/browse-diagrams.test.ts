import { beforeEach, describe, expect, it, vi } from "vitest";

const { getJsonObject, listObjects, putJsonObject } = vi.hoisted(() => ({
  getJsonObject: vi.fn(),
  listObjects: vi.fn(),
  putJsonObject: vi.fn(),
}));

vi.mock("~/server/storage/r2", () => ({
  getJsonObject,
  listObjects,
  putJsonObject,
}));

import {
  BrowseIndexNotFoundError,
  backfillBrowseIndex,
  fillMissingBrowseIndexStars,
  fetchGitHubStarsInBatches,
  getBrowsePage,
  upsertBrowseIndexEntry,
} from "~/server/storage/browse-diagrams";

describe("browse diagram storage", () => {
  beforeEach(() => {
    process.env.R2_PUBLIC_BUCKET = "test-public-bucket";
    vi.clearAllMocks();
  });

  it("upserts a new repo and preserves browse metadata", async () => {
    getJsonObject.mockResolvedValue({
      version: 1,
      updatedAt: "2026-03-27T12:00:00.000Z",
      entries: [
        {
          username: "older",
          repo: "repo",
          lastSuccessfulAt: "2026-03-27T12:00:00.000Z",
          stargazerCount: 5,
        },
      ],
    });

    const entries = await upsertBrowseIndexEntry({
      username: "Acme",
      repo: "Demo",
      lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
      stargazerCount: 42,
    });

    expect(entries).toEqual([
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
        stargazerCount: 42,
      },
      {
        username: "older",
        repo: "repo",
        lastSuccessfulAt: "2026-03-27T12:00:00.000Z",
        stargazerCount: 5,
      },
    ]);
    expect(putJsonObject).toHaveBeenCalledWith(
      "test-public-bucket",
      "public/v1/_meta/browse-index.json",
      expect.objectContaining({
        version: 1,
        entries,
      }),
    );
  });

  it("supports recent and star sorting, search, filtering, and pagination", async () => {
    getJsonObject.mockResolvedValue({
      version: 1,
      updatedAt: "2026-03-29T12:00:00.000Z",
      entries: [
        {
          username: "vercel",
          repo: "next.js",
          lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
          stargazerCount: 130000,
        },
        {
          username: "acme",
          repo: "demo",
          lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
          stargazerCount: null,
        },
        {
          username: "vercel",
          repo: "swr",
          lastSuccessfulAt: "2026-03-27T12:00:00.000Z",
          stargazerCount: 32000,
        },
      ],
    });

    const starsResult = await getBrowsePage({
      sort: "stars_desc",
    });
    const filteredResult = await getBrowsePage({
      q: "vercel",
      minStars: "1000",
      sort: "recent_desc",
      page: "2",
    });

    expect(starsResult.items.map((item) => `${item.username}/${item.repo}`)).toEqual([
      "vercel/next.js",
      "vercel/swr",
      "acme/demo",
    ]);
    expect(
      filteredResult.items.map((item) => `${item.username}/${item.repo}`),
    ).toEqual(["vercel/next.js", "vercel/swr"]);
    expect(filteredResult.total).toBe(2);
    expect(filteredResult.page).toBe(1);
  });

  it("fails cleanly when the browse index manifest is missing", async () => {
    getJsonObject.mockResolvedValue(null);

    await expect(
      getBrowsePage({
        sort: "recent_desc",
      }),
    ).rejects.toBeInstanceOf(BrowseIndexNotFoundError);
  });

  it("batches GitHub star lookups and merges the results", async () => {
    const fetchBatch = vi
      .fn<
        (batch: Array<{ username: string; repo: string }>) => Promise<Map<string, number | null>>
      >()
      .mockImplementation(async (batch) => {
        return new Map(
          batch.map((repo) => [`${repo.username}/${repo.repo}`, batch.length]),
        );
      });

    const repos = Array.from({ length: 120 }, (_, index) => ({
      username: "owner",
      repo: `repo-${index}`,
    }));

    const stars = await fetchGitHubStarsInBatches(repos, {
      batchSize: 50,
      concurrency: 2,
      fetchBatch,
    });

    expect(fetchBatch).toHaveBeenCalledTimes(3);
    expect(fetchBatch.mock.calls.map((call) => call[0].length)).toEqual([
      50,
      50,
      20,
    ]);
    expect(stars.get("owner/repo-0")).toBe(50);
    expect(stars.get("owner/repo-119")).toBe(20);
  });

  it("backfills the browse index from artifacts and ignores _meta objects", async () => {
    const putJsonObjectFn = vi.fn();
    const fetchStarsFn = vi.fn(async () => {
      return new Map([
        ["acme/demo", 42],
        ["vercel/next.js", 130000],
      ]);
    });

    const entries = await backfillBrowseIndex({
      now: new Date("2026-03-29T12:00:00.000Z"),
      listObjectsFn: async () => [
        {
          key: "public/v1/_meta/browse-index.json",
          lastModified: "2026-03-29T11:59:00.000Z",
          size: 100,
        },
        {
          key: "public/v1/acme/demo.json",
          lastModified: "2026-03-29T10:00:00.000Z",
          size: 100,
        },
        {
          key: "public/v1/vercel/next.js.json",
          lastModified: "2026-03-28T10:00:00.000Z",
          size: 100,
        },
      ],
      getJsonObjectFn: (async (_bucket, key) => {
        if (key === "public/v1/acme/demo.json") {
          return {
            username: "acme",
            repo: "demo",
            lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
            generatedAt: "2026-03-29T10:00:00.000Z",
            stargazerCount: null,
          };
        }

        return {
          username: "vercel",
          repo: "next.js",
          lastSuccessfulAt: "2026-03-28T10:00:00.000Z",
          generatedAt: "2026-03-28T10:00:00.000Z",
          stargazerCount: 100000,
        };
      }) as <T>(bucket: string, key: string) => Promise<T | null>,
      putJsonObjectFn,
      fetchStarsFn,
    });

    expect(fetchStarsFn).toHaveBeenCalledWith([
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
        stargazerCount: null,
      },
    ]);
    expect(entries).toEqual([
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
        stargazerCount: 42,
      },
      {
        username: "vercel",
        repo: "next.js",
        lastSuccessfulAt: "2026-03-28T10:00:00.000Z",
        stargazerCount: 130000,
      },
    ]);
    expect(putJsonObjectFn).toHaveBeenCalledTimes(2);
    expect(putJsonObjectFn.mock.calls[0]).toEqual([
      "test-public-bucket",
      "public/v1/_meta/browse-index.json",
      {
        version: 1,
        updatedAt: "2026-03-29T12:00:00.000Z",
        entries: [
          {
            username: "acme",
            repo: "demo",
            lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
            stargazerCount: null,
          },
          {
            username: "vercel",
            repo: "next.js",
            lastSuccessfulAt: "2026-03-28T10:00:00.000Z",
            stargazerCount: 100000,
          },
        ],
      },
    ]);
    expect(putJsonObjectFn.mock.calls[1]).toEqual([
      "test-public-bucket",
      "public/v1/_meta/browse-index.json",
      {
        version: 1,
        updatedAt: "2026-03-29T12:00:00.000Z",
        entries,
      },
    ]);
  });

  it("resumes from an existing browse index without losing fetched stars", async () => {
    const putJsonObjectFn = vi.fn();

    const entries = await backfillBrowseIndex({
      now: new Date("2026-03-29T12:00:00.000Z"),
      listObjectsFn: async () => [
        {
          key: "public/v1/acme/demo.json",
          lastModified: "2026-03-29T10:00:00.000Z",
          size: 100,
        },
      ],
      getJsonObjectFn: (async (_bucket, key) => {
        if (key === "public/v1/_meta/browse-index.json") {
          return {
            version: 1,
            updatedAt: "2026-03-29T11:00:00.000Z",
            entries: [
              {
                username: "acme",
                repo: "demo",
                lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
                stargazerCount: 42,
              },
            ],
          };
        }

        return {
          username: "acme",
          repo: "demo",
          lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
          generatedAt: "2026-03-29T10:00:00.000Z",
          stargazerCount: null,
        };
      }) as <T>(bucket: string, key: string) => Promise<T | null>,
      putJsonObjectFn,
      fetchStarsFn: async () => new Map(),
    });

    expect(entries).toEqual([
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
        stargazerCount: 42,
      },
    ]);
    expect(putJsonObjectFn).toHaveBeenCalledWith(
      "test-public-bucket",
      "public/v1/_meta/browse-index.json",
      {
        version: 1,
        updatedAt: "2026-03-29T12:00:00.000Z",
        entries: [
          {
            username: "acme",
            repo: "demo",
            lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
            stargazerCount: 42,
          },
        ],
      },
    );
  });

  it("fills only the missing browse stars from an existing index", async () => {
    const putJsonObjectFn = vi.fn();

    const entries = await fillMissingBrowseIndexStars({
      now: new Date("2026-03-29T12:00:00.000Z"),
      getJsonObjectFn: (async () => ({
        version: 1,
        updatedAt: "2026-03-29T11:00:00.000Z",
        entries: [
          {
            username: "acme",
            repo: "demo",
            lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
            stargazerCount: null,
          },
          {
            username: "vercel",
            repo: "next.js",
            lastSuccessfulAt: "2026-03-28T10:00:00.000Z",
            stargazerCount: 130000,
          },
        ],
      })) as <T>(bucket: string, key: string) => Promise<T | null>,
      putJsonObjectFn,
      fetchStarsFn: async () => new Map([["acme/demo", 42]]),
    });

    expect(entries).toEqual([
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T10:00:00.000Z",
        stargazerCount: 42,
      },
      {
        username: "vercel",
        repo: "next.js",
        lastSuccessfulAt: "2026-03-28T10:00:00.000Z",
        stargazerCount: 130000,
      },
    ]);
    expect(putJsonObjectFn).toHaveBeenCalledWith(
      "test-public-bucket",
      "public/v1/_meta/browse-index.json",
      {
        version: 1,
        updatedAt: "2026-03-29T12:00:00.000Z",
        entries,
      },
    );
  });
});
