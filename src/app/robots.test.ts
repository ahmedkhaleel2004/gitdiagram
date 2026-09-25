import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Sitemaps from "~/lib/sitemaps";

const store = vi.hoisted(() => ({
  browse: [] as Array<{
    username: string;
    repo: string;
    lastSuccessfulAt: string;
  }>,
  videos: [] as Array<{ owner: string; repo: string; updatedAt?: Date }>,
  videosOn: true,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>) => read,
}));
vi.mock("~/server/browse-index-cache", () => ({
  getCachedBrowseIndex: async () => store.browse,
}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => store.videosOn,
}));
vi.mock("~/server/explainer/store", () => ({
  listStoredVideos: async () => store.videos,
}));
vi.mock("~/lib/sitemaps", async (importOriginal) => ({
  ...(await importOriginal<typeof Sitemaps>()),
  // Small pages make the shard arithmetic visible.
  SITEMAP_PAGE_SIZE: 10,
  getSitemapCount: (routeCount: number) =>
    Math.max(1, Math.ceil((routeCount + 4) / 10)),
}));

import robots from "./robots";
import sitemap, { generateSitemaps } from "./sitemap";

const entry = (index: number) => ({
  username: "acme",
  repo: `repo-${index}`,
  lastSuccessfulAt: "2026-09-01T00:00:00.000Z",
});

beforeEach(() => {
  store.browse = [];
  store.videos = [];
  store.videosOn = true;
});

describe("robots.txt", () => {
  it("lets link-preview crawlers fetch video posters under /api", async () => {
    const [everyone] = (await robots()).rules as Array<{
      allow: string[];
      disallow: string[];
    }>;
    expect(everyone!.disallow).toContain("/api/");
    expect(everyone!.allow).toContain("/api/video/file");
  });

  it("lists every sitemap shard, video pages included", async () => {
    store.browse = Array.from({ length: 5 }, (_, index) => entry(index));
    store.videos = Array.from({ length: 5 }, (_, index) => ({
      owner: "acme",
      repo: `video-${index}`,
    }));
    const shards = await generateSitemaps();
    expect(shards).toHaveLength(2);
    expect((await robots()).sitemap).toEqual([
      "https://gitdiagram.com/sitemap/0.xml",
      "https://gitdiagram.com/sitemap/1.xml",
    ]);
  });
});

describe("sitemap", () => {
  it("lists the video gallery with the fixed pages while videos are on", async () => {
    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (route) => route.url,
    );
    expect(urls).toContain("https://gitdiagram.com/videos");

    store.videosOn = false;
    const without = (await sitemap({ id: Promise.resolve("0") })).map(
      (route) => route.url,
    );
    expect(without).not.toContain("https://gitdiagram.com/videos");
  });
});
