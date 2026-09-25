import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readVideoArtifact: vi.fn(),
  hasRender: vi.fn(),
  readPicture: vi.fn(),
  readRender: vi.fn(),
  renderDownloadUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => true,
}));
vi.mock("~/server/explainer/cache", () => ({
  videoResponseTag: (username: string, repo: string) =>
    `video/${username}/${repo}`,
}));
vi.mock("~/server/explainer/store", () => ({
  hasRender: mocks.hasRender,
  readPicture: mocks.readPicture,
  readRender: mocks.readRender,
  readVideoArtifact: mocks.readVideoArtifact,
  renderDownloadUrl: mocks.renderDownloadUrl,
}));

import { GET } from "./route";

const v = "2026-09-24T08:06:45.297Z";
const get = (query: Record<string, string>) =>
  GET(
    new Request(
      `https://gitdiagram.com/api/video/file?${new URLSearchParams({
        username: "acme",
        repo: "widget",
        v,
        ...query,
      }).toString()}`,
    ),
  );

beforeEach(() => {
  mocks.readVideoArtifact.mockResolvedValue({
    createdAt: v,
    meta: { owner: "acme", repo: "widget" },
  });
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/video/file", () => {
  it("redirects an MP4 download only when the file exists", async () => {
    mocks.renderDownloadUrl.mockResolvedValue("https://r2.example/signed");
    mocks.hasRender.mockResolvedValue(true);
    const found = await get({ format: "landscape" });
    expect(found.status).toBe(302);
    expect(found.headers.get("location")).toBe("https://r2.example/signed");

    mocks.hasRender.mockResolvedValue(false);
    const missing = await get({ format: "landscape" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
  });

  it("caches a poster forever only when its URL names when it was made", async () => {
    mocks.readRender.mockResolvedValue(Buffer.from("jpg"));
    const stamped = await get({ format: "poster", p: "1790237205297" });
    expect(stamped.headers.get("cache-control")).toContain("immutable");
    const bare = await get({ format: "still" });
    expect(bare.status).toBe(200);
    expect(bare.headers.get("cache-control")).not.toContain("immutable");
  });

  it("serves the latest video's poster without a version, and nothing else", async () => {
    mocks.readRender.mockResolvedValue(Buffer.from("jpg"));
    const latest = await get({ format: "poster", v: "" });
    expect(latest.status).toBe(400);
    const request = (format: string) =>
      GET(
        new Request(
          `https://gitdiagram.com/api/video/file?username=acme&repo=widget&format=${format}`,
        ),
      );
    const poster = await request("poster");
    expect(poster.status).toBe(200);
    expect(poster.headers.get("cache-control")).not.toContain("immutable");
    expect(poster.headers.get("vercel-cache-tag")).toBe("video/acme/widget");
    expect(mocks.readRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ createdAt: v }),
      "poster.jpg",
    );
    for (const format of ["still", "landscape", "vertical", "picture"])
      expect((await request(format)).status).toBe(400);
  });

  it("serves a film's README picture forever, and only picture ids", async () => {
    // A JPEG header: SOI, then SOF0 (height 600, width 800).
    const jpeg = Buffer.alloc(40);
    jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 2, 88, 3, 32]);
    mocks.readPicture.mockResolvedValue(jpeg);
    const found = await get({ format: "picture", id: "img2" });
    expect(found.status).toBe(200);
    expect(found.headers.get("content-type")).toBe("image/jpeg");
    expect(found.headers.get("cache-control")).toContain("immutable");
    expect(mocks.readPicture).toHaveBeenCalledWith("acme", "widget", v, "img2");
    expect((await get({ format: "picture", id: "../x" })).status).toBe(400);
    mocks.readPicture.mockResolvedValue(Buffer.from("<svg onload=alert(1)>"));
    expect((await get({ format: "picture", id: "img1" })).status).toBe(404);
    mocks.readPicture.mockResolvedValue(null);
    expect((await get({ format: "picture", id: "img1" })).status).toBe(404);
  });

  it("never caches an MP4 streamed from local storage", async () => {
    mocks.renderDownloadUrl.mockResolvedValue(null);
    mocks.readRender.mockResolvedValue(Buffer.from("mp4"));
    const response = await get({ format: "vertical" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "acme-widget-explained-vertical.mp4",
    );
  });
});
