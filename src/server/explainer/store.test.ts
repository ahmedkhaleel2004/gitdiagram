import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  keys: [] as string[],
  published: null as { createdAt: string } | null | Error,
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
  getJsonObject: vi.fn(async (_bucket: string, key: string) => {
    mocks.calls.push(`get ${key}`);
    if (mocks.published instanceof Error) throw mocks.published;
    return mocks.published;
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
  mocks.published = null;
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
    expect(staleVideoKeys(keys, artifact, "1790000000000")).toEqual([
      `${current}/landscape.e14.mp4`,
      `${current}/vertical.e9.mp4`,
      `${current}/poster.e13.jpg`,
      `${root}/1780000000000/beat-00.mp3`,
      `${root}/1780000000000/beat-01.mp3`,
      `${root}/1770000000000/landscape.e15.mp4`,
    ]);
    // Without knowing what it replaced, only the renders go.
    expect(staleVideoKeys(keys, artifact)).toEqual([
      `${current}/landscape.e14.mp4`,
      `${current}/vertical.e9.mp4`,
      `${current}/poster.e13.jpg`,
    ]);
  });

  it("keeps the published version it replaced, not a newer failed upload", () => {
    // Published A, then B's upload failed before its artifact was written,
    // then C was published: A is what open tabs show, B was never seen.
    const keys = [
      `${root}/1770000000000/beat-00.mp3`,
      `${root}/1780000000000/beat-00.mp3`,
      `${root}/1790000000000/beat-00.mp3`,
      `${current}/beat-00.mp3`,
    ];
    expect(staleVideoKeys(keys, artifact, "1780000000000")).toEqual([
      `${root}/1770000000000/beat-00.mp3`,
      `${root}/1790000000000/beat-00.mp3`,
    ]);
    // With nothing published before, every older folder is left over.
    expect(staleVideoKeys(keys, artifact, null)).toEqual(keys.slice(0, 3));
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
    expect(staleVideoKeys(keys, artifact, null)).toEqual([]);
  });

  it("stores a new version, drops the cached answer, then prunes", async () => {
    process.env.VIDEO_STORE = "r2";
    process.env.R2_PUBLIC_BUCKET = "bucket";
    mocks.keys.push(
      `${root}/1790000000000/beat-00.mp3`,
      `${root}/1780000000000/beat-00.mp3`,
    );
    mocks.published = { createdAt: new Date(1790000000000).toISOString() };
    await writeVideo(artifact, [Buffer.from("clip")]);
    expect(mocks.calls).toEqual([
      `get ${root}/artifact.json`,
      `put ${current}/beat-00.mp3`,
      `put ${root}/artifact.json`,
      "index",
      "purge",
      "list",
      `delete ${root}/1780000000000/beat-00.mp3`,
    ]);
  });

  it("prunes no older version when the published one cannot be read", async () => {
    process.env.VIDEO_STORE = "r2";
    process.env.R2_PUBLIC_BUCKET = "bucket";
    mocks.keys.push(`${root}/1780000000000/beat-00.mp3`);
    mocks.published = new Error("R2 is down");
    await writeVideo(artifact, [Buffer.from("clip")]);
    expect(mocks.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
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

  it("deletes a failed upload's files but keeps the version tabs still show", async () => {
    const a = "2026-09-01T00:00:00.000Z";
    const b = "2026-09-02T00:00:00.000Z";
    const c = "2026-09-03T00:00:00.000Z";
    await writeVideo(version(a), [Buffer.from("a")]);
    // B's clips were uploaded, but it failed before its artifact was written.
    const orphan = join(dir, ".video-cache", root, String(Date.parse(b)));
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, "beat-00.mp3"), "b");
    await writeVideo(version(c), [Buffer.from("c")]);
    const files = await readdir(join(dir, ".video-cache", root), {
      recursive: true,
    });
    expect(files.sort()).toEqual([
      String(Date.parse(a)),
      `${Date.parse(a)}/beat-00.mp3`,
      String(Date.parse(c)),
      `${Date.parse(c)}/beat-00.mp3`,
      "artifact.json",
    ]);
  });
});
