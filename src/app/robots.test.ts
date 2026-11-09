import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Sitemaps from "~/lib/sitemaps";

const store = vi.hoisted(() => ({
  browse: [] as Array<{
    username: string;
    repo: string;
    lastSuccessfulAt: string;
  }>,
  videos: [] as Array<{ owner: string; repo: string; createdAt?: string }>,
  videosOn: true,
  wholeIndexReads: 0,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>) => read,
}));
vi.mock("~/server/browse-index-cache", () => ({
  getCachedBrowseIndex: async () => {
    store.wholeIndexReads += 1;
    return store.browse;
  },
  getCachedBrowseIndexTotal: async () => store.browse.length,
}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => store.videosOn,
}));
vi.mock("~/server/explainer/catalog", () => ({
  listVideoCards: async () => store.videos,
}));
vi.mock("~/lib/sitemaps", async (importOriginal) => ({
  ...(await importOriginal<typeof Sitemaps>()),
  // Small pages make the shard arithmetic visible.
  SITEMAP_PAGE_SIZE: 20,
  getSitemapCount: (routeCount: number, fixedRouteCount: number) =>
    Math.max(1, Math.ceil((routeCount + fixedRouteCount) / 20)),
}));

import robots from "./robots";
import sitemap, { generateSitemaps } from "./sitemap";
import { GET as sitemapIndex } from "./sitemap_index.xml/route";

const entry = (index: number) => ({
  username: "acme",
  repo: `repo-${index}`,
  lastSuccessfulAt: "2026-09-01T00:00:00.000Z",
});

beforeEach(() => {
  store.browse = [];
  store.videos = [];
  store.videosOn = true;
  store.wholeIndexReads = 0;
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

  it("lets crawlers load what a watch page needs, not the analytics proxy", async () => {
    for (const rule of (
      (await robots()).rules as Array<{
        allow: string | string[];
        disallow: string[];
      }>
    ).slice(0, 3)) {
      // A rendered watch page asks /api/video?username=…&repo=… for the video.
      expect(rule.allow).toEqual(
        expect.arrayContaining(["/api/video?", "/api/video/audio"]),
      );
      expect(rule.disallow).toEqual(
        expect.arrayContaining(["/phx9a/", "/api/video/file?*format=still"]),
      );
    }
  });

  it("names the AI search and assistant crawlers with the same rules", async () => {
    const rules = (await robots()).rules as Array<{
      userAgent: string | string[];
      allow: string | string[];
      disallow: string[];
    }>;
    const [everyone, , ai] = rules;
    expect(ai!.userAgent).toEqual(
      expect.arrayContaining([
        "OAI-SearchBot",
        "ChatGPT-User",
        "GPTBot",
        "ClaudeBot",
        "Claude-SearchBot",
        "Claude-User",
        "PerplexityBot",
        "Perplexity-User",
        "Google-Extended",
        "Applebot-Extended",
      ]),
    );
    // Pages, /llms.txt and /{owner}/{repo}.md are all under "/".
    expect(ai!.allow).toEqual(everyone!.allow);
    expect(ai!.disallow).toEqual(everyone!.disallow);
    // No crawler is kept off repository pages any more.
    expect(rules).toHaveLength(3);
    expect(JSON.stringify(rules)).not.toContain("/*/*");
  });

  it("lets search engines fetch sponsor links so they see noindex", async () => {
    const [everyone, search] = (await robots()).rules as Array<{
      userAgent: string[];
      allow: string[];
      disallow: string[];
    }>;
    expect(search!.userAgent).toEqual(["Googlebot", "bingbot"]);
    expect(search!.allow).toEqual(everyone!.allow);
    expect(search!.disallow).toEqual([
      "/api/",
      "/phx9a/",
      "/api/video/file?*format=still",
    ]);
    expect(everyone!.disallow).toContain("/out/");
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
      "https://gitdiagram.com/sitemap_index.xml",
      "https://gitdiagram.com/sitemap/0.xml",
      "https://gitdiagram.com/sitemap/1.xml",
    ]);
  });

  it("never reads the whole browse index", async () => {
    // It renders on the placed server, which the whole index can kill.
    // 35 repositories and the 14 fixed pages make three pages of twenty.
    store.browse = Array.from({ length: 35 }, (_, index) => entry(index));
    expect((await robots()).sitemap).toHaveLength(4);
    expect(store.wholeIndexReads).toBe(0);
  });

  it("does not list an empty shard when videos are off", async () => {
    // Twelve fixed pages and eight repositories fill exactly one page of twenty.
    store.videosOn = false;
    store.browse = Array.from({ length: 8 }, (_, index) => entry(index));
    expect(await generateSitemaps()).toHaveLength(1);
    store.videosOn = true;
    expect(await generateSitemaps()).toHaveLength(2);
  });
});

describe("sitemap index", () => {
  it("lists every shard robots.txt lists, without the whole index", async () => {
    store.browse = Array.from({ length: 35 }, (_, index) => entry(index));
    const response = await sitemapIndex();
    expect(response.headers.get("content-type")).toContain("application/xml");
    const body = await response.text();
    expect(body).toContain("<sitemapindex");
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(((await robots()).sitemap as string[]).slice(1));
    expect(locs).toHaveLength(3);
    expect(store.wholeIndexReads).toBe(0);
  });
});

describe("sitemap", () => {
  it("lists the video gallery with the fixed pages while videos are on", async () => {
    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (route) => route.url,
    );
    expect(urls).toContain("https://gitdiagram.com/videos");
    expect(urls).toContain("https://gitdiagram.com/visualize-codebase");

    store.videosOn = false;
    const without = (await sitemap({ id: Promise.resolve("0") })).map(
      (route) => route.url,
    );
    expect(without).not.toContain("https://gitdiagram.com/videos");
  });
});

describe("sitemap order", () => {
  it("opens the first page with the most-starred repositories, each once", async () => {
    store.videos = [{ owner: "acme", repo: "video-0" }];
    store.browse = Array.from({ length: 30 }, (_, index) => ({
      ...entry(index),
      stargazerCount: index === 25 ? 90_000 : index === 3 ? 50_000 : 10,
    }));
    const pages = [
      ...(await sitemap({ id: Promise.resolve("0") })),
      ...(await sitemap({ id: Promise.resolve("1") })),
      ...(await sitemap({ id: Promise.resolve("2") })),
    ];
    const urls = pages.map((route) => route.url);
    const repoUrls = urls.filter((url) => url.includes("/acme/repo-"));
    // Every repository once, the starred ones first (all 30 fit the small
    // test cap of 1,000 popular entries, so the order is by stars).
    expect(new Set(repoUrls).size).toBe(30);
    expect(repoUrls.slice(0, 2)).toEqual([
      "https://gitdiagram.com/acme/repo-25",
      "https://gitdiagram.com/acme/repo-3",
    ]);
    expect(urls).toHaveLength(new Set(urls).size);
  });
});
