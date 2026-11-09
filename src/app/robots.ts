import type { MetadataRoute } from "next";
import { SITE_URL } from "~/lib/site";
import { getSitemapUrls } from "~/lib/sitemaps";
import { generateSitemaps } from "./sitemap";

// The crawlers behind ChatGPT, Claude, Perplexity, Gemini, Apple and Bing.
const AI_CRAWLERS = [
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
];

// Search engines also get /out/: each sponsor link answers with
// X-Robots-Tag: noindex, which they can only see if they may fetch it.
// Blocked, Google indexes the bare URL from the links pointing at it
// ("Indexed, though blocked by robots.txt"). Their user agents contain "bot",
// so their fetches are never counted as sponsor clicks.
const SEARCH_ENGINES = ["Googlebot", "bingbot"];

// Under /api, what a watch page or a link preview loads: the posters, the
// video's state (the player shows "Failed to fetch" without it, which Google
// filed as Soft 404) and its narration. The longer rule wins over "/api/".
const API_ALLOW = ["/api/video/file", "/api/video?", "/api/video/audio"];

// Fetches that cost crawl budget and show a crawler nothing: the analytics
// proxy (a quarter of Googlebot's requests in early November) and the
// gallery's thumbnail stills. Posters stay allowed: they are the video
// thumbnails search reads from VideoObject.
const CRAWL_WASTE = ["/phx9a/", "/api/video/file?*format=still"];

export default async function robots(): Promise<MetadataRoute.Robots> {
  // The same pages the sitemap splits into, so every shard is listed.
  const sitemaps = await generateSitemaps();

  return {
    rules: [
      {
        userAgent: "*",
        // Video posters live under /api but are link previews: X and LinkedIn
        // honor robots.txt before fetching og:image.
        allow: ["/", ...API_ALLOW],
        disallow: ["/api/", "/out/", ...CRAWL_WASTE],
      },
      {
        userAgent: SEARCH_ENGINES,
        allow: ["/", ...API_ALLOW],
        disallow: ["/api/", ...CRAWL_WASTE],
      },
      {
        // AI search and assistant crawlers read the pages, /llms.txt and each
        // repository's Markdown twin (/{owner}/{repo}.md). Named explicitly,
        // since a crawler follows only the most specific group naming it.
        userAgent: [...AI_CRAWLERS],
        allow: ["/", ...API_ALLOW],
        disallow: ["/api/", "/out/", ...CRAWL_WASTE],
      },
      {
        // Bulk repo/image crawls create disproportionate origin
        // traffic. Match the route-scoped WAF policy and prevent future crawls.
        userAgent: ["Amazonbot", "Brightbot"],
        allow: "/",
        disallow: ["/api/", "/out/", "/*/*"],
      },
    ],
    sitemap: [
      `${SITE_URL}/sitemap_index.xml`,
      ...getSitemapUrls(SITE_URL, sitemaps.length),
    ],
  };
}
