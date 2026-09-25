import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  keys: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("~/features/explainer/engine", () => ({ ENGINE_VERSION: "15" }));
vi.mock("./cache", () => ({
  purgeVideoResponse: vi.fn(async () => {
    mocks.calls.push("purge");
  }),
}));
vi.mock("./video-index", () => ({
  indexVideo: vi.fn(async () => {
    mocks.calls.push("index");
  }),
}));
vi.mock("~/server/storage/r2", () => ({
  putBinaryObject: vi.fn(async (_bucket: string, key: string) => {
    mocks.calls.push(`put ${key}`);
  }),
  putJsonObject: vi.fn(async (_bucket: string, key: string) => {
    mocks.calls.push(`put ${key}`);
  }),
  listObjects: vi.fn(async () => {
    mocks.calls.push("list");
    return mocks.keys.map((key) => ({ key, lastModified: null }));
  }),
  deleteObject: vi.fn(async (_bucket: string, key: string) => {
    mocks.calls.push(`delete ${key}`);
  }),
}));

import type { VideoArtifact } from "~/features/explainer/types";
import { staleVideoKeys, videoVersion, writeVideo } from "./store";

const artifact = {
  createdAt: "2026-09-24T08:06:45.297Z",
  meta: { owner: "Acme", repo: "Widget" },
} as VideoArtifact;
const root = "video/v1/acme/widget";
const current = `${root}/1790237205297`;
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  mocks.calls.length = 0;
  mocks.keys.length = 0;
  vi.restoreAllMocks();
});

describe("explainer video storage", () => {
  it("names a video's file folder after its creation time", () => {
    expect(videoVersion("2026-09-24T08:06:45.297Z")).toBe("1790237205297");
    expect(videoVersion("not a date")).toBeNull();
  });

  it("names the files the current version no longer uses, keeping the one it replaced", () => {
    const keys = [
      `${root}/artifact.json`,
      `${current}/beat-00.mp3`,
      `${current}/poster.jpg`,
      `${current}/still.jpg`,
      `${current}/landscape.e15.mp4`,
      `${current}/landscape.e14.mp4`,
      `${current}/vertical.e9.mp4`,
      `${current}/poster.e13.jpg`,
      `${root}/1790000000000/beat-00.mp3`,
      `${root}/1790000000000/landscape.e15.mp4`,
      `${root}/1780000000000/beat-00.mp3`,
      `${root}/1780000000000/beat-01.mp3`,
      `${root}/1770000000000/landscape.e15.mp4`,
    ];
    expect(staleVideoKeys(keys, artifact)).toEqual([
      `${current}/landscape.e14.mp4`,
      `${current}/vertical.e9.mp4`,
      `${current}/poster.e13.jpg`,
      `${root}/1780000000000/beat-00.mp3`,
      `${root}/1780000000000/beat-01.mp3`,
      `${root}/1770000000000/landscape.e15.mp4`,
    ]);
  });

  it("never names newer files, or another repository's", () => {
    const keys = [
      `${root}/1799999999999/beat-00.mp3`,
      `${current}/landscape.e16.mp4`,
      `${current}/poster.e16.jpg`,
      "video/v1/acme/widget-two/1780000000000/beat-00.mp3",
      "video/v1/acme/widget-two/1770000000000/beat-00.mp3",
      "video/v1/acme/widgetx/artifact.json",
    ];
    expect(staleVideoKeys(keys, artifact)).toEqual([]);
  });

  it("stores a new version, drops the cached answer, then prunes", async () => {
    process.env.VIDEO_STORE = "r2";
    process.env.R2_PUBLIC_BUCKET = "bucket";
    mocks.keys.push(
      `${root}/1790000000000/beat-00.mp3`,
      `${root}/1780000000000/beat-00.mp3`,
    );
    await writeVideo(artifact, [Buffer.from("clip")]);
    expect(mocks.calls).toEqual([
      `put ${current}/beat-00.mp3`,
      `put ${root}/artifact.json`,
      "index",
      "purge",
      "list",
      `delete ${root}/1780000000000/beat-00.mp3`,
    ]);
  });
});

describe("local video storage", () => {
  let dir = "";
  const version = (createdAt: string) =>
    ({ ...artifact, createdAt }) as VideoArtifact;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "video-store-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    process.env.VIDEO_STORE = "local";
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prunes like production, keeping the replaced version, and leaves no temp files", async () => {
    await writeVideo(version("2026-09-01T00:00:00.000Z"), [Buffer.from("a")]);
    await writeVideo(version("2026-09-02T00:00:00.000Z"), [Buffer.from("b")]);
    await writeVideo(version("2026-09-03T00:00:00.000Z"), [Buffer.from("c")]);
    const files = await readdir(join(dir, ".video-cache", root), {
      recursive: true,
    });
    expect(files.sort()).toEqual([
      String(Date.parse("2026-09-02T00:00:00.000Z")),
      `${Date.parse("2026-09-02T00:00:00.000Z")}/beat-00.mp3`,
      String(Date.parse("2026-09-03T00:00:00.000Z")),
      `${Date.parse("2026-09-03T00:00:00.000Z")}/beat-00.mp3`,
      "artifact.json",
    ]);
    expect(mocks.calls).not.toContain("purge");
  });
});
