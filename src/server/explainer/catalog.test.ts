import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashCommand: vi.fn(),
  upstashEval: vi.fn(),
  listStoredVideos: vi.fn(),
  readVideoArtifact: vi.fn(),
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
  videoStoreBackend: () => mocks.backend,
}));

import type { VideoCard } from "~/features/explainer/catalog-types";
import type { VideoArtifact } from "~/features/explainer/types";
import { listVideoCards } from "./catalog";
import { indexVideo, videoCard } from "./video-index";

const artifact = (repo: string, createdAt: string) =>
  ({
    createdAt,
    repository: `acme/${repo}`,
    meta: { owner: "Acme", repo, stars: 10, language: "TypeScript" },
    plan: { title: `${repo} explained`, beats: [{ narration: "Hello." }] },
    timing: { DURATION: 61.4 },
  }) as unknown as VideoArtifact;

beforeEach(() => {
  mocks.backend = "r2";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    const cards: VideoCard[] = [
      videoCard(artifact("old", "2026-01-01T00:00:00.000Z")),
      videoCard(artifact("new", "2026-09-01T00:00:00.000Z"), 99),
    ];
    mocks.upstashCommand.mockImplementation(async ([command]: string[]) =>
      command === "GET" ? "1" : cards.map((card) => JSON.stringify(card)),
    );
    const listed = await listVideoCards();
    expect(listed.map((card) => card.repo)).toEqual(["new", "old"]);
    expect(listed[0]!.posterAt).toBe(99);
    expect(mocks.listStoredVideos).not.toHaveBeenCalled();
  });

  it("builds the index from R2 once, with every video", async () => {
    storeVideos(400);
    mocks.upstashCommand.mockImplementation(async ([command]: string[]) =>
      command === "GET" ? null : "OK",
    );
    mocks.upstashEval.mockResolvedValue(100);
    const listed = await listVideoCards();
    expect(listed).toHaveLength(400);
    expect(listed[0]!.repo).toBe("repo-399");
    const written = mocks.upstashEval.mock.calls.flatMap(([call]) =>
      (call as { args: string[] }).args.slice(1),
    );
    expect(written).toHaveLength(400 * 3);
    expect(
      mocks.upstashEval.mock.calls.every(
        ([call]) => (call as { args: string[] }).args[0] === "missing",
      ),
    ).toBe(true);
    expect(mocks.upstashCommand).toHaveBeenCalledWith([
      "SET",
      "video:v1:index:ready",
      "1",
    ]);
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
