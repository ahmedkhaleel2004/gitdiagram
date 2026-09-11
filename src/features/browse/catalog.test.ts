import { describe, expect, it } from "vitest";

import {
  getBrowsePageFromPreparedIndex,
  getBrowsePageFromRecentIndex,
  prepareBrowseIndex,
  type BrowseIndexEntry,
} from "~/features/browse/catalog";

const entries: BrowseIndexEntry[] = [
  {
    username: "vercel",
    repo: "swr",
    lastSuccessfulAt: "2026-03-27T12:00:00.000Z",
    stargazerCount: 32_000,
  },
  {
    username: "acme",
    repo: "demo",
    lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
    stargazerCount: null,
  },
  {
    username: "vercel",
    repo: "next.js",
    lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
    stargazerCount: 130_000,
  },
];

describe("prepared browse index", () => {
  it("preserves exact substring search, filtering, and ordering", () => {
    const index = prepareBrowseIndex(entries);

    const stars = getBrowsePageFromPreparedIndex(index, {
      sort: "stars_desc",
    });
    const filtered = getBrowsePageFromPreparedIndex(index, {
      q: "VERCEL/",
      minStars: 1000,
      sort: "recent_asc",
    });

    expect(stars.items.map((entry) => entry.repo)).toEqual([
      "next.js",
      "swr",
      "demo",
    ]);
    expect(filtered.items.map((entry) => entry.repo)).toEqual([
      "swr",
      "next.js",
    ]);
    expect(index.sortedEntries.size).toBe(2);
  });

  it("reuses a prepared sort across repeated queries", () => {
    const index = prepareBrowseIndex(entries);

    getBrowsePageFromPreparedIndex(index, { sort: "name_asc" });
    const preparedNameSort = index.sortedEntries.get("name_asc");
    getBrowsePageFromPreparedIndex(index, {
      q: "vercel",
      sort: "name_asc",
    });

    expect(index.sortedEntries.get("name_asc")).toBe(preparedNameSort);
  });
});

describe("recent browse shard", () => {
  it("serves covered default pages while preserving the full index total", () => {
    const shardEntries = Array.from({ length: 20 }, (_, index) => ({
      ...entries[0]!,
      repo: `repo-${index}`,
    }));
    const result = getBrowsePageFromRecentIndex(
      { entries: shardEntries, total: 81_178 },
      { page: 1 },
    );

    expect(result).toMatchObject({
      items: shardEntries,
      total: 81_178,
      page: 1,
      totalPages: 4_059,
      sort: "recent_desc",
    });
  });

  it("falls back for uncovered pages, searches, filters, and other sorts", () => {
    expect(
      getBrowsePageFromRecentIndex({ entries, total: 81_178 }, { page: 2 }),
    ).toBeNull();
    expect(
      getBrowsePageFromRecentIndex({ entries, total: 3 }, { q: "vercel" }),
    ).toBeNull();
    expect(
      getBrowsePageFromRecentIndex({ entries, total: 3 }, { minStars: 100 }),
    ).toBeNull();
    expect(
      getBrowsePageFromRecentIndex(
        { entries, total: 3 },
        { sort: "stars_desc" },
      ),
    ).toBeNull();
  });
});
