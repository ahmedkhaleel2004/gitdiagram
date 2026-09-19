import type { MetadataRoute } from "next";
import { getCachedBrowseIndex } from "~/server/browse-index-cache";
import { SITE_URL } from "~/lib/site";
import { getSitemapCount, getSitemapUrls } from "~/lib/sitemaps";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const browseEntries = await getCachedBrowseIndex().catch(() => null);
  const sitemapCount = getSitemapCount(browseEntries?.length ?? 0);

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
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
    sitemap: getSitemapUrls(SITE_URL, sitemapCount),
  };
}
