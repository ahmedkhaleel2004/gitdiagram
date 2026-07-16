import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/storage/distributed-lock", () => ({
  withDistributedLock: vi.fn(
    async ({ callback }: { callback: () => Promise<unknown> }) => callback(),
  ),
}));

const { getGzipJsonObject, getJsonObject, putGzipJsonObject } = vi.hoisted(
  () => ({
    getGzipJsonObject: vi.fn(),
    getJsonObject: vi.fn(),
    putGzipJsonObject: vi.fn(),
  }),
);

vi.mock("~/server/storage/r2", () => ({
  getGzipJsonObject,
  getJsonObject,
  putGzipJsonObject,
}));

import {
  BrowseIndexNotFoundError,
  getBrowsePage,
  migrateBrowseIndexToCompressedV2,
  upsertBrowseIndexEntry,
} from "~/server/storage/browse-diagrams";

describe("browse diagram storage", () => {
  beforeEach(() => {
    process.env.R2_PUBLIC_BUCKET = "test-public-bucket";
    vi.clearAllMocks();
    getGzipJsonObject.mockResolvedValue(null);
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
    expect(putGzipJsonObject).toHaveBeenCalledWith(
      "test-public-bucket",
      "public/v2/_meta/browse-index.json.gz",
      expect.objectContaining({
        version: 2,
        entries,
      }),
    );
  });

  it("prefers the compressed manifest without reading the legacy object", async () => {
    getGzipJsonObject.mockResolvedValue({
      version: 1,
      updatedAt: "2026-03-29T12:00:00.000Z",
      entries: [
        {
          username: "Vercel",
          repo: "Next.js",
          lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
          stargazerCount: 130000,
        },
      ],
    });

    const result = await getBrowsePage({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({ username: "vercel", repo: "next.js" }),
    );
    expect(getJsonObject).not.toHaveBeenCalled();
  });

  it("does not rewrite the manifest for a stale repository update", async () => {
    getGzipJsonObject.mockResolvedValue({
      version: 1,
      updatedAt: "2026-03-29T12:00:00.000Z",
      entries: [
        {
          username: "acme",
          repo: "demo",
          lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
          stargazerCount: 42,
        },
      ],
    });

    const entries = await upsertBrowseIndexEntry({
      username: "acme",
      repo: "demo",
      lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
      stargazerCount: 99,
    });

    expect(entries[0]?.stargazerCount).toBe(42);
    expect(putGzipJsonObject).not.toHaveBeenCalled();
  });

  it("falls back to the legacy manifest during the storage migration", async () => {
    getJsonObject.mockResolvedValue({
      version: 1,
      updatedAt: "2026-03-29T12:00:00.000Z",
      entries: [
        {
          username: "acme",
          repo: "demo",
          lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
          stargazerCount: 42,
        },
      ],
    });

    const result = await getBrowsePage({});

    expect(result.items).toHaveLength(1);
    expect(getJsonObject).toHaveBeenCalledWith(
      "test-public-bucket",
      "public/v1/_meta/browse-index.json",
    );
  });

  it("seeds the compressed manifest under the browse-index lock", async () => {
    getJsonObject.mockResolvedValue({
      version: 1,
      updatedAt: "2026-03-29T12:00:00.000Z",
      entries: [
        {
          username: "Acme",
          repo: "Demo",
          lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
          stargazerCount: 42,
        },
      ],
    });

    await expect(migrateBrowseIndexToCompressedV2()).resolves.toBe(1);
    expect(putGzipJsonObject).toHaveBeenCalledWith(
      "test-public-bucket",
      "public/v2/_meta/browse-index.json.gz",
      expect.objectContaining({
        version: 2,
        entries: [expect.objectContaining({ username: "acme", repo: "demo" })],
      }),
    );
  });

  it("does not rewrite an already-canonical compressed manifest", async () => {
    const entries = [
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
        stargazerCount: 42,
      },
    ];
    getGzipJsonObject
      .mockResolvedValueOnce({
        version: 2,
        updatedAt: "2026-03-29T12:00:00.000Z",
        entries,
      })
      .mockResolvedValueOnce({
        version: 1,
        updatedAt: "2026-03-29T12:00:00.000Z",
        total: 1,
        entries,
      });

    await expect(migrateBrowseIndexToCompressedV2()).resolves.toBe(1);
    expect(getJsonObject).not.toHaveBeenCalled();
    expect(putGzipJsonObject).not.toHaveBeenCalled();
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

    expect(
      starsResult.items.map((item) => `${item.username}/${item.repo}`),
    ).toEqual(["vercel/next.js", "vercel/swr", "acme/demo"]);
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
});
