import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/storage/distributed-lock", () => ({
  withDistributedLock: vi.fn(
    async ({ callback }: { callback: () => Promise<unknown> }) => callback(),
  ),
}));

const pendingMocks = vi.hoisted(() => ({
  acknowledgePendingBrowseIndexEntries: vi.fn(),
  enqueuePendingBrowseIndexEntry: vi.fn(),
  readPendingBrowseIndexEntries: vi.fn(),
}));

vi.mock("~/server/storage/browse-index-pending", () => pendingMocks);

const storageMocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  getGzipJsonObject: vi.fn(),
  getGzipJsonObjectWithEtag: vi.fn(),
  getJsonObject: vi.fn(),
  putGzipJsonObject: vi.fn(),
}));

vi.mock("~/server/storage/r2", () => storageMocks);

import {
  BrowseIndexNotFoundError,
  getBrowsePage,
  migrateBrowseIndexToAtomicV3,
  readRecentBrowseIndex,
  upsertBrowseIndexEntry,
  type BrowseIndexEntry,
} from "~/server/storage/browse-diagrams";

const BUCKET = "test-public-bucket";
const LEGACY_KEY = "public/v1/_meta/browse-index.json";
const V2_INDEX_KEY = "public/v2/_meta/browse-index.json.gz";
const V3_MANIFEST_KEY = "public/v3/_meta/browse-index-manifest.json.gz";
const V3_SNAPSHOT_PREFIX = "public/v3/_meta/browse-index-snapshot-";

let gzipObjects: Map<string, unknown>;
let jsonObjects: Map<string, unknown>;
let pendingEntries: Array<{
  field: string;
  serialized: string;
  entry: BrowseIndexEntry;
}>;

function seedAtomicIndex(
  entries: BrowseIndexEntry[],
  generation = "existing-generation",
  retainedGenerations = [generation],
) {
  const snapshotKey = `${V3_SNAPSHOT_PREFIX}${generation}.json.gz`;
  for (const retainedGeneration of retainedGenerations) {
    gzipObjects.set(`${V3_SNAPSHOT_PREFIX}${retainedGeneration}.json.gz`, {
      version: 3,
      generation: retainedGeneration,
      updatedAt: "2026-03-29T12:00:00.000Z",
      entries,
    });
  }
  gzipObjects.set(V3_MANIFEST_KEY, {
    version: 3,
    generation,
    updatedAt: "2026-03-29T12:00:00.000Z",
    snapshotKey,
    retainedSnapshotKeys: retainedGenerations.map(
      (retainedGeneration) =>
        `${V3_SNAPSHOT_PREFIX}${retainedGeneration}.json.gz`,
    ),
    total: entries.length,
    entries: entries.slice(0, 2_000),
  });
  return snapshotKey;
}

describe("browse diagram storage", () => {
  beforeEach(() => {
    process.env.R2_PUBLIC_BUCKET = BUCKET;
    vi.clearAllMocks();
    gzipObjects = new Map();
    jsonObjects = new Map();
    pendingEntries = [];
    pendingMocks.enqueuePendingBrowseIndexEntry.mockImplementation(
      async (entry: BrowseIndexEntry) => {
        const field = `${entry.username}/${entry.repo}`;
        const serialized = `pending|${JSON.stringify(entry)}`;
        pendingEntries = [
          ...pendingEntries.filter((pending) => pending.field !== field),
          { field, serialized, entry: structuredClone(entry) },
        ];
      },
    );
    pendingMocks.readPendingBrowseIndexEntries.mockImplementation(async () =>
      structuredClone(pendingEntries),
    );
    pendingMocks.acknowledgePendingBrowseIndexEntries.mockImplementation(
      async (
        acknowledged: Array<{
          field: string;
          serialized: string;
          entry: BrowseIndexEntry;
        }>,
      ) => {
        pendingEntries = pendingEntries.filter(
          (pending) =>
            !acknowledged.some(
              (candidate) =>
                candidate.field === pending.field &&
                candidate.serialized === pending.serialized,
            ),
        );
      },
    );
    storageMocks.getGzipJsonObject.mockImplementation(
      async (_bucket: string, key: string) => {
        const value = gzipObjects.get(key);
        return value === undefined ? null : structuredClone(value);
      },
    );
    storageMocks.getGzipJsonObjectWithEtag.mockImplementation(
      async (_bucket: string, key: string) => {
        const value = gzipObjects.get(key);
        return value === undefined
          ? null
          : {
              value: structuredClone(value),
              etag: '"test-manifest-etag"',
            };
      },
    );
    storageMocks.getJsonObject.mockImplementation(
      async (_bucket: string, key: string) => {
        const value = jsonObjects.get(key);
        return value === undefined ? null : structuredClone(value);
      },
    );
    storageMocks.putGzipJsonObject.mockImplementation(
      async (_bucket: string, key: string, payload: unknown) => {
        gzipObjects.set(key, structuredClone(payload));
      },
    );
    storageMocks.deleteObject.mockImplementation(
      async (_bucket: string, key: string) => {
        gzipObjects.delete(key);
      },
    );
  });

  it("publishes a full snapshot before atomically committing its recent manifest", async () => {
    jsonObjects.set(LEGACY_KEY, {
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

    expect(entries.map(({ username, repo }) => `${username}/${repo}`)).toEqual([
      "acme/demo",
      "older/repo",
    ]);
    const snapshotCall = storageMocks.putGzipJsonObject.mock.calls[0];
    const manifestCall = storageMocks.putGzipJsonObject.mock.calls[1];
    expect(snapshotCall?.[0]).toBe(BUCKET);
    expect(snapshotCall?.[1]).toMatch(
      /^public\/v3\/_meta\/browse-index-snapshot-.+\.json\.gz$/,
    );
    expect(snapshotCall?.[2]).toMatchObject({ version: 3, entries });
    expect(manifestCall).toEqual([
      BUCKET,
      V3_MANIFEST_KEY,
      expect.objectContaining({
        version: 3,
        snapshotKey: snapshotCall?.[1],
        total: 2,
        entries,
      }),
      { ifNoneMatch: true },
    ]);
    expect(
      storageMocks.putGzipJsonObject.mock.invocationCallOrder[0],
    ).toBeLessThan(storageMocks.putGzipJsonObject.mock.invocationCallOrder[1]!);
  });

  it("reads the committed snapshot without consulting legacy objects", async () => {
    seedAtomicIndex([
      {
        username: "vercel",
        repo: "next.js",
        lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
        stargazerCount: 130000,
      },
    ]);

    const result = await getBrowsePage({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({ username: "vercel", repo: "next.js" }),
    );
    expect(storageMocks.getJsonObject).not.toHaveBeenCalled();
    expect(
      storageMocks.getGzipJsonObject.mock.calls.some(
        (call) => call[1] === V2_INDEX_KEY,
      ),
    ).toBe(false);
  });

  it("serves the recent projection directly from the atomic manifest", async () => {
    const entries = [
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
        stargazerCount: 42,
      },
    ];
    seedAtomicIndex(entries);

    await expect(readRecentBrowseIndex()).resolves.toEqual({
      total: 1,
      entries,
    });
    expect(storageMocks.getGzipJsonObject).toHaveBeenCalledOnce();
    expect(storageMocks.getGzipJsonObject).toHaveBeenCalledWith(
      BUCKET,
      V3_MANIFEST_KEY,
    );
  });

  it("does not rewrite a committed snapshot for a stale repository update", async () => {
    seedAtomicIndex([
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
        stargazerCount: 42,
      },
    ]);

    const entries = await upsertBrowseIndexEntry({
      username: "acme",
      repo: "demo",
      lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
      stargazerCount: 99,
    });

    expect(entries[0]?.stargazerCount).toBe(42);
    expect(storageMocks.putGzipJsonObject).not.toHaveBeenCalled();
    expect(storageMocks.deleteObject).not.toHaveBeenCalled();
  });

  it("retries a failed manifest commit with a fresh staged snapshot", async () => {
    const previousSnapshotKey = seedAtomicIndex([
      {
        username: "older",
        repo: "repo",
        lastSuccessfulAt: "2026-03-27T12:00:00.000Z",
        stargazerCount: 5,
      },
    ]);
    let manifestAttempts = 0;
    storageMocks.putGzipJsonObject.mockImplementation(
      async (_bucket: string, key: string, payload: unknown) => {
        if (key === V3_MANIFEST_KEY && manifestAttempts++ === 0) {
          throw new Error("transient manifest failure");
        }
        gzipObjects.set(key, structuredClone(payload));
      },
    );

    await expect(
      upsertBrowseIndexEntry({
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
        stargazerCount: 42,
      }),
    ).resolves.toHaveLength(2);

    const snapshotKeys = storageMocks.putGzipJsonObject.mock.calls
      .map((call) => call[1] as string)
      .filter((key) => key.startsWith(V3_SNAPSHOT_PREFIX));
    expect(new Set(snapshotKeys).size).toBe(2);
    expect(manifestAttempts).toBe(2);
    expect(storageMocks.deleteObject).not.toHaveBeenCalled();
    expect(gzipObjects.get(V3_MANIFEST_KEY)).toMatchObject({
      retainedSnapshotKeys: expect.arrayContaining([previousSnapshotKey]),
    });
  });

  it("keeps an update journaled when materialization exhausts its retries", async () => {
    seedAtomicIndex([
      {
        username: "older",
        repo: "repo",
        lastSuccessfulAt: "2026-03-27T12:00:00.000Z",
        stargazerCount: 5,
      },
    ]);
    storageMocks.putGzipJsonObject.mockImplementation(
      async (_bucket: string, key: string, payload: unknown) => {
        if (key === V3_MANIFEST_KEY) {
          throw new Error("R2 unavailable");
        }
        gzipObjects.set(key, structuredClone(payload));
      },
    );

    await expect(
      upsertBrowseIndexEntry({
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
        stargazerCount: 42,
      }),
    ).rejects.toThrow("R2 unavailable");
    expect(pendingEntries).toHaveLength(1);
    expect(
      pendingMocks.acknowledgePendingBrowseIndexEntries,
    ).not.toHaveBeenCalled();

    storageMocks.putGzipJsonObject.mockImplementation(
      async (_bucket: string, key: string, payload: unknown) => {
        gzipObjects.set(key, structuredClone(payload));
      },
    );
    await expect(migrateBrowseIndexToAtomicV3()).resolves.toBe(2);
    expect(pendingEntries).toHaveLength(0);
    const page = await getBrowsePage({});
    expect(page.items[0]).toEqual(
      expect.objectContaining({ username: "acme", repo: "demo" }),
    );
  });

  it("keeps the committed index when cleanup of the previous snapshot fails", async () => {
    seedAtomicIndex(
      [
        {
          username: "older",
          repo: "repo",
          lastSuccessfulAt: "2026-03-27T12:00:00.000Z",
          stargazerCount: 5,
        },
      ],
      "generation-0",
      Array.from({ length: 8 }, (_, index) => `generation-${index}`),
    );
    storageMocks.deleteObject.mockRejectedValue(new Error("cleanup failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      upsertBrowseIndexEntry({
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
        stargazerCount: 42,
      }),
    ).resolves.toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("browse.index.snapshot_cleanup_failed"),
    );
  });

  it("falls back to the legacy manifest during migration", async () => {
    jsonObjects.set(LEGACY_KEY, {
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
    expect(storageMocks.getJsonObject).toHaveBeenCalledWith(BUCKET, LEGACY_KEY);
  });

  it("migrates a legacy index to an atomic snapshot and manifest", async () => {
    jsonObjects.set(LEGACY_KEY, {
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

    await expect(migrateBrowseIndexToAtomicV3()).resolves.toBe(1);
    expect(gzipObjects.get(V3_MANIFEST_KEY)).toMatchObject({
      version: 3,
      total: 1,
      entries: [expect.objectContaining({ username: "acme", repo: "demo" })],
    });
  });

  it("does not rewrite an already-atomic index during migration", async () => {
    seedAtomicIndex([
      {
        username: "acme",
        repo: "demo",
        lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
        stargazerCount: 42,
      },
    ]);

    await expect(migrateBrowseIndexToAtomicV3()).resolves.toBe(1);
    expect(storageMocks.putGzipJsonObject).not.toHaveBeenCalled();
    expect(storageMocks.deleteObject).not.toHaveBeenCalled();
  });

  it("refuses to migrate pending rows without a canonical baseline", async () => {
    pendingEntries = [
      {
        field: "acme/demo",
        serialized: "pending|acme/demo",
        entry: {
          username: "acme",
          repo: "demo",
          lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
          stargazerCount: 42,
        },
      },
    ];

    await expect(migrateBrowseIndexToAtomicV3()).rejects.toBeInstanceOf(
      BrowseIndexNotFoundError,
    );
    expect(storageMocks.putGzipJsonObject).not.toHaveBeenCalled();
    expect(pendingEntries).toHaveLength(1);
  });

  it("supports recent and star sorting, search, filtering, and pagination", async () => {
    jsonObjects.set(LEGACY_KEY, {
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

  it("fails cleanly when every browse index location is missing", async () => {
    await expect(
      getBrowsePage({
        sort: "recent_desc",
      }),
    ).rejects.toBeInstanceOf(BrowseIndexNotFoundError);
  });
});
