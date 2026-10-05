import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowseIndexEntry } from "~/features/browse/catalog";

const mocks = vi.hoisted(() => ({
  readBrowseIndex: vi.fn(),
  readRecentBrowseIndex: vi.fn(),
}));

// A stale-while-revalidate data cache here once froze the Newest list: the
// module must not put one back between the page and storage.
vi.mock("next/cache", () => {
  throw new Error("browse-index-cache must not use Next's data cache");
});

vi.mock("~/server/storage/browse-diagrams", () => ({
  RECENT_BROWSE_INDEX_SIZE: 2_000,
  readBrowseIndex: mocks.readBrowseIndex,
  readRecentBrowseIndex: mocks.readRecentBrowseIndex,
}));

vi.mock("~/server/storage/artifact-store", () => ({
  getPublicDiagramPreview: vi.fn(),
}));

const oldEntries: BrowseIndexEntry[] = [
  {
    username: "old",
    repo: "repo",
    lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
    stargazerCount: 1,
  },
];
const freshEntries: BrowseIndexEntry[] = [
  {
    username: "fresh",
    repo: "repo",
    lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
    stargazerCount: 2,
  },
];

describe("browse data cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.readRecentBrowseIndex.mockResolvedValue(null);
  });

  it("serves default pages from the small recent shard", async () => {
    const recentEntries = Array.from({ length: 20 }, (_, index) => ({
      username: "recent",
      repo: `repo-${index}`,
      lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
      stargazerCount: index,
    }));
    mocks.readRecentBrowseIndex.mockResolvedValue({
      entries: recentEntries,
      total: 81_178,
    });
    const data = await import("~/server/browse-index-cache");

    await expect(data.getCachedBrowsePage({})).resolves.toMatchObject({
      items: recentEntries,
      total: 81_178,
      totalPages: 4_059,
    });
    expect(mocks.readBrowseIndex).not.toHaveBeenCalled();
  });

  it("reads the recent index from storage again once its five minutes are up", async () => {
    vi.useFakeTimers();
    try {
      const recent = (repo: string, total: number) => ({
        entries: Array.from({ length: 20 }, (_, index) => ({
          username: "recent",
          repo: `${repo}-${index}`,
          lastSuccessfulAt: "2026-10-05T18:47:37.914Z",
          stargazerCount: 0,
        })),
        total,
      });
      mocks.readRecentBrowseIndex
        .mockResolvedValueOnce(recent("older", 175_390))
        .mockResolvedValueOnce(recent("newer", 175_548));
      const data = await import("~/server/browse-index-cache");

      await expect(data.getCachedBrowsePage({})).resolves.toMatchObject({
        total: 175_390,
      });
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      await expect(data.getCachedBrowsePage({})).resolves.toMatchObject({
        total: 175_390,
      });
      expect(mocks.readRecentBrowseIndex).toHaveBeenCalledTimes(1);

      // The first request after expiry gets the new index itself, not the
      // old one with a refresh left running behind it.
      await vi.advanceTimersByTimeAsync(61 * 1000);
      await expect(data.getCachedBrowsePage({})).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ repo: "newer-0" }),
        ]),
        total: 175_548,
      });
      expect(mocks.readRecentBrowseIndex).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the recent index when a diagram run revalidates it", async () => {
    mocks.readRecentBrowseIndex
      .mockResolvedValueOnce({ entries: oldEntries, total: 1 })
      .mockResolvedValueOnce({ entries: freshEntries, total: 1 });
    const data = await import("~/server/browse-index-cache");

    await expect(data.getCachedBrowsePage({})).resolves.toMatchObject({
      total: 1,
    });
    data.revalidateBrowseIndexCache();
    await expect(data.getCachedBrowsePage({})).resolves.toMatchObject({
      items: freshEntries,
    });
  });

  it("does not let a read invalidated in flight repopulate stale data", async () => {
    let resolveOldRead!: (entries: BrowseIndexEntry[]) => void;
    const oldRead = new Promise<BrowseIndexEntry[]>((resolve) => {
      resolveOldRead = resolve;
    });
    mocks.readBrowseIndex
      .mockReturnValueOnce(oldRead)
      .mockResolvedValueOnce(freshEntries);
    const data = await import("~/server/browse-index-cache");

    const firstRead = data.getCachedBrowseIndex();
    data.revalidateBrowseIndexCache();
    await expect(data.getCachedBrowseIndex()).resolves.toBe(freshEntries);
    resolveOldRead(oldEntries);

    await expect(firstRead).resolves.toBe(oldEntries);
    await expect(data.getCachedBrowseIndex()).resolves.toBe(freshEntries);
    expect(mocks.readBrowseIndex).toHaveBeenCalledTimes(2);
  });
});
