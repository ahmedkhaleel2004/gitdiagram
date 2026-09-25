import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  enabled: true,
  getVideoCatalog: vi.fn(async () => []),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: server.notFound }));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => server.enabled,
}));
vi.mock("~/server/explainer/catalog", () => ({
  getVideoCatalog: server.getVideoCatalog,
}));
vi.mock("~/components/explainer/video-catalog", () => ({
  VideoCatalog: () => null,
}));

import VideosIndexPage, { metadata } from "./page";

beforeEach(() => {
  server.enabled = true;
  vi.clearAllMocks();
});

describe("/videos", () => {
  it("has its own link preview instead of the homepage's", () => {
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      url: "https://gitdiagram.com/videos",
      images: [expect.objectContaining({ url: "/opengraph-image.png" })],
    });
    expect(metadata.twitter).toMatchObject({
      title: metadata.title,
      images: [expect.objectContaining({ url: "/twitter-image.png" })],
    });
  });

  it("is not found while explainer videos are off", async () => {
    server.enabled = false;
    await expect(VideosIndexPage()).rejects.toThrow("not-found");
    expect(server.getVideoCatalog).not.toHaveBeenCalled();
  });
});
