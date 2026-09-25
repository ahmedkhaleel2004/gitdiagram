import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  enabled: true,
  getFirstVideoPage: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: server.notFound }));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => server.enabled,
}));
vi.mock("~/server/explainer/catalog", () => ({
  getFirstVideoPage: server.getFirstVideoPage,
}));
vi.mock("~/components/explainer/video-catalog", () => ({
  VideoCatalog: () => null,
}));

import VideosIndexPage, { metadata } from "./page";

/** The props the page hands the gallery. */
function catalogProps(element: unknown): Record<string, unknown> {
  const found: Array<Record<string, unknown>> = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const { props } = node as { props?: Record<string, unknown> };
    if (!props) return;
    if ("initial" in props) found.push(props);
    walk(props.children);
  };
  walk(element);
  return found[0]!;
}

beforeEach(() => {
  server.enabled = true;
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
    expect(server.getFirstVideoPage).not.toHaveBeenCalled();
  });

  it("hands the gallery only its first page", async () => {
    const page = { cards: [], total: 0, page: 1 };
    server.getFirstVideoPage.mockResolvedValue(page);
    expect(catalogProps(await VideosIndexPage())).toEqual({ initial: page });
  });

  it("throws when the videos cannot be read, so the last good page stays", async () => {
    server.getFirstVideoPage.mockRejectedValue(new Error("Redis down"));
    await expect(VideosIndexPage()).rejects.toThrow("Redis down");
  });

  it("builds with an empty gallery rather than failing the deploy", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    server.getFirstVideoPage.mockRejectedValue(new Error("Redis down"));
    expect(catalogProps(await VideosIndexPage()).initial).toMatchObject({
      cards: [],
      total: 0,
    });
  });
});
