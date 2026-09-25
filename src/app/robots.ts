import type { MetadataRoute } from "next";
import { SITE_URL } from "~/lib/site";
import { getSitemapUrls } from "~/lib/sitemaps";
import { generateSitemaps } from "./sitemap";

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
