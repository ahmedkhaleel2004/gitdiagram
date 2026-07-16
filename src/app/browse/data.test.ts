import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowseIndexEntry } from "~/features/browse/catalog";

const mocks = vi.hoisted(() => ({
  readBrowseIndex: vi.fn(),
  readRecentBrowseIndex: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  unstable_cache:
    (callback: (...args: never[]) => unknown) =>
    (...args: never[]) =>
      callback(...args),
}));

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
    const data = await import("~/app/browse/data");

    await expect(data.getCachedBrowsePage({})).resolves.toMatchObject({
      items: recentEntries,
      total: 81_178,
      totalPages: 4_059,
    });
    expect(mocks.readBrowseIndex).not.toHaveBeenCalled();
  });

  it("does not let a read invalidated in flight repopulate stale data", async () => {
    let resolveOldRead!: (entries: BrowseIndexEntry[]) => void;
    const oldRead = new Promise<BrowseIndexEntry[]>((resolve) => {
      resolveOldRead = resolve;
    });
    mocks.readBrowseIndex
      .mockReturnValueOnce(oldRead)
      .mockResolvedValueOnce(freshEntries);
    const data = await import("~/app/browse/data");

    const firstRead = data.getCachedBrowseIndex();
    data.revalidateBrowseIndexCache();
    await expect(data.getCachedBrowseIndex()).resolves.toBe(freshEntries);
    resolveOldRead(oldEntries);

    await expect(firstRead).resolves.toBe(oldEntries);
    await expect(data.getCachedBrowseIndex()).resolves.toBe(freshEntries);
    expect(mocks.readBrowseIndex).toHaveBeenCalledTimes(2);
  });
});
