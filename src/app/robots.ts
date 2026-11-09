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

export default async function robots(): Promise<MetadataRoute.Robots> {
  // The same pages the sitemap splits into, so every shard is listed.
  const sitemaps = await generateSitemaps();

  return {
    rules: [
      {
        userAgent: "*",
        // Video posters live under /api but are link previews: X and LinkedIn
        // honor robots.txt before fetching og:image. The longer rule wins.
        allow: ["/", "/api/video/file"],
        disallow: ["/api/", "/out/"],
      },
      {
        userAgent: SEARCH_ENGINES,
        allow: ["/", "/api/video/file"],
        disallow: ["/api/"],
      },
      {
        // AI search and assistant crawlers read the pages, /llms.txt and each
        // repository's Markdown twin (/{owner}/{repo}.md). Named explicitly,
        // since a crawler follows only the most specific group naming it.
        userAgent: [...AI_CRAWLERS],
        allow: ["/", "/api/video/file"],
        disallow: ["/api/", "/out/"],
      },
      {
        // Bulk repo/image crawls create disproportionate origin
        // traffic. Match the route-scoped WAF policy and prevent future crawls.
        userAgent: ["Amazonbot", "Brightbot"],
        allow: "/",
        disallow: ["/api/", "/out/", "/*/*"],
      },
    ],
    sitemap: getSitemapUrls(SITE_URL, sitemaps.length),
  };
}
