import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readVideoArtifact: vi.fn(),
  hasRender: vi.fn(),
  readRender: vi.fn(),
  renderDownloadUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => true,
}));
vi.mock("~/server/explainer/store", () => ({
  hasRender: mocks.hasRender,
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
