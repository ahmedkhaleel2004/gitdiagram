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
});
