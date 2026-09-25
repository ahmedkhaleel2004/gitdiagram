import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashCommand: vi.fn(),
  upstashEval: vi.fn(),
  listStoredVideos: vi.fn(),
  readVideoArtifact: vi.fn(),
  renderStamp: vi.fn(),
  backend: "r2" as "r2" | "local",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>) => read,
}));
vi.mock("./cache", () => ({ VIDEO_CATALOG_TAG: "catalog" }));
vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: mocks.upstashCommand,
  upstashEval: mocks.upstashEval,
}));
vi.mock("./store", () => ({
  listStoredVideos: mocks.listStoredVideos,
  readVideoArtifact: mocks.readVideoArtifact,
  renderStamp: mocks.renderStamp,
  videoStoreBackend: () => mocks.backend,
}));

import {
  VIDEO_PAGE_SIZE,
  type VideoCard,
} from "~/features/explainer/catalog-types";
import type { VideoArtifact } from "~/features/explainer/types";
import {
  getFirstVideoPage,
  getVideoPage,
  listVideoCards,
  resetVideoCatalogForTests,
} from "./catalog";
import { indexVideo, videoCard } from "./video-index";

const artifact = (repo: string, createdAt: string, stars = 10) =>
  ({
    createdAt,
    repository: `acme/${repo}`,
    meta: { owner: "Acme", repo, stars, language: "TypeScript" },
    plan: { title: `${repo} explained`, beats: [{ narration: "Hello." }] },
    timing: { DURATION: 61.4 },
  }) as unknown as VideoArtifact;

beforeEach(() => {
  mocks.backend = "r2";
  mocks.renderStamp.mockResolvedValue(null);
  resetVideoCatalogForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** A stored video for every name, 400 of them: more than the old 300 cap. */
function storeVideos(count: number) {
  const videos = Array.from({ length: count }, (_, index) =>
    artifact(
      `repo-${index}`,
      new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      index,
    ),
  );
  mocks.listStoredVideos.mockResolvedValue(
    videos.map((video) => ({ owner: "acme", repo: video.meta.repo })),
  );
  mocks.readVideoArtifact.mockImplementation(async (_owner, repo: string) =>
    videos.find((video) => video.meta.repo === repo),
  );
  return videos;
}

/**
 * A Redis holding the index: whether it is ready, its cards, and whether a
 * build may be claimed. Records what was set.
 */
function redis({
  ready = false,
  cards = [] as VideoCard[],
  claimable = true,
} = {}) {
  const set: unknown[][] = [];
  mocks.upstashCommand.mockImplementation(async (command: unknown[]) => {
    if (command[0] === "GET") return ready ? "1" : null;
    if (command[0] === "HVALS")
      return cards.map((card) => JSON.stringify(card));
    if (command[0] === "SET") {
      set.push(command);
      if (command[1] === "video:v1:index:building")
        return claimable ? "OK" : null;
      return "OK";
    }
    return null;
  });
  mocks.upstashEval.mockResolvedValue(100);
  return set;
}

describe("the video index", () => {
  it("writes a card that the script can check against newer versions", async () => {
    mocks.upstashEval.mockResolvedValue(1);
    const video = artifact("widget", "2026-09-24T08:06:45.297Z");
    await indexVideo(video, { posterAt: 1234 });
    const { keys, args, script } = mocks.upstashEval.mock.calls[0]![0] as {
      keys: string[];
      args: string[];
      script: string;
    };
    expect(keys).toEqual(["video:v1:index"]);
    expect(args[0]).toBe("replace");
    expect(args[1]).toBe("acme/widget");
    expect(args[2]).toMatch(/^\{"createdAt":"2026-09-24T08:06:45.297Z"/);
    expect(JSON.parse(args[2]!)).toEqual(videoCard(video, 1234));
    expect(args[3]).toBe(video.createdAt);
    expect(script).toContain("stored <= ARGV[index + 2]");
  });

  it("never throws when Redis is down", async () => {
    mocks.upstashEval.mockRejectedValue(new Error("down"));
    await expect(
      indexVideo(artifact("widget", "2026-09-24T08:06:45.297Z")),
    ).resolves.toBeUndefined();
  });
});

describe("the video catalog", () => {
  it("lists every card from the index, newest first, without reading R2", async () => {
    redis({
      ready: true,
      cards: [
        videoCard(artifact("old", "2026-01-01T00:00:00.000Z")),
        videoCard(artifact("new", "2026-09-01T00:00:00.000Z"), 99),
      ],
    });
    const listed = await listVideoCards();
    expect(listed.map((card) => card.repo)).toEqual(["new", "old"]);
    expect(listed[0]!.posterAt).toBe(99);
    expect(mocks.listStoredVideos).not.toHaveBeenCalled();
  });

  it("builds the index from R2 once, with every video and its still's stamp", async () => {
    storeVideos(400);
    mocks.renderStamp.mockImplementation(async (video: VideoArtifact) =>
      video.meta.repo === "repo-399" ? 555 : null,
    );
    const set = redis();
    const listed = await listVideoCards();
    expect(listed).toHaveLength(400);
    expect(listed[0]!.repo).toBe("repo-399");
    // Backfilled stills get stamped URLs, like ones indexed as they were made.
    expect(listed[0]!.posterAt).toBe(555);
    expect(listed[1]!.posterAt).toBeUndefined();
    const written = mocks.upstashEval.mock.calls.flatMap(([call]) =>
      (call as { args: string[] }).args.slice(1),
    );
    expect(written).toHaveLength(400 * 3);
    expect(
      mocks.upstashEval.mock.calls.every(
        ([call]) => (call as { args: string[] }).args[0] === "missing",
      ),
    ).toBe(true);
    expect(set).toContainEqual(["SET", "video:v1:index:ready", "1"]);
  });

  it("leaves the index unready when an artifact could not be read, to build it again later", async () => {
    storeVideos(5);
    const read = mocks.readVideoArtifact.getMockImplementation()!;
    mocks.readVideoArtifact.mockImplementation(async (owner, repo: string) => {
      if (repo === "repo-2") throw new Error("R2 blip");
      return read(owner, repo);
    });
    const set = redis();
    expect(await listVideoCards()).toHaveLength(4);
    // The four it read are indexed, but the index is not marked ready.
    expect(mocks.upstashEval).toHaveBeenCalled();
    expect(set).not.toContainEqual(["SET", "video:v1:index:ready", "1"]);
    expect(set).toContainEqual([
      "SET",
      "video:v1:index:building",
      "1",
      "NX",
      "EX",
      300,
    ]);
  });

  it("lists what is indexed so far while another build holds the claim", async () => {
    storeVideos(5);
    redis({
      cards: [videoCard(artifact("indexed", "2026-09-01T00:00:00.000Z"))],
      claimable: false,
    });
    const listed = await listVideoCards();
    expect(listed.map((card) => card.repo)).toEqual(["indexed"]);
    expect(mocks.listStoredVideos).not.toHaveBeenCalled();
  });

  it("fails rather than show an empty gallery while the first build runs elsewhere", async () => {
    redis({ claimable: false });
    await expect(listVideoCards()).rejects.toThrow(/being built/);
    await expect(getFirstVideoPage()).rejects.toThrow(/being built/);
  });

  it("still lists everything from R2 when Redis is down", async () => {
    storeVideos(320);
    mocks.upstashCommand.mockRejectedValue(new Error("down"));
    await expect(listVideoCards()).resolves.toHaveLength(320);
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("never touches Redis for local videos", async () => {
    mocks.backend = "local";
    storeVideos(3);
    await expect(listVideoCards()).resolves.toHaveLength(3);
    expect(mocks.upstashCommand).not.toHaveBeenCalled();
  });
});

describe("gallery pages", () => {
  const cards = Array.from({ length: 60 }, (_, index) =>
    videoCard(
      artifact(
        `repo-${String(index).padStart(2, "0")}`,
        new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        index * 100,
      ),
    ),
  );

  it("sends one page of cards at a time, newest first by default", async () => {
    redis({ ready: true, cards });
    const first = await getFirstVideoPage();
    expect(first.cards).toHaveLength(VIDEO_PAGE_SIZE);
    expect(first.cards[0]!.repo).toBe("repo-59");
    expect(first).toMatchObject({
      total: 60,
      page: 1,
      pageSize: VIDEO_PAGE_SIZE,
      totalPages: 3,
      sort: "recent_desc",
    });
    expect(first).not.toHaveProperty("items");
  });

  it("searches, filters, sorts and pages like /browse", async () => {
    redis({ ready: true, cards });
    const page = await getVideoPage({
      q: "REPO-5",
      sort: "stars_asc",
      minStars: "100",
      page: "1",
    });
    expect(page.cards.map((card) => card.repo)).toEqual(
      Array.from({ length: 10 }, (_, index) => `repo-5${index}`),
    );
    const last = await getVideoPage({ sort: "name_asc", page: "99" });
    expect(last.page).toBe(3);
    expect(last.cards.map((card) => card.repo)).toEqual(
      Array.from({ length: 12 }, (_, index) => `repo-${48 + index}`),
    );
  });

  it("reads the index once a minute per instance for its pages", async () => {
    redis({ ready: true, cards });
    await getVideoPage({ page: "1" });
    await getVideoPage({ page: "2" });
    const reads = mocks.upstashCommand.mock.calls.filter(
      ([command]) => (command as unknown[])[0] === "HVALS",
    );
    expect(reads).toHaveLength(1);
  });

  it("throws when the videos cannot be listed", async () => {
    mocks.upstashCommand.mockRejectedValue(new Error("down"));
    mocks.listStoredVideos.mockRejectedValue(new Error("R2 down"));
    await expect(getVideoPage({})).rejects.toThrow("R2 down");
  });
});
