import type { MetadataRoute } from "next";
import { getCachedBrowseIndex } from "~/app/browse/data";
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
        disallow: ["/api/"],
      },
    ],
    sitemap: getSitemapUrls(SITE_URL, sitemapCount),
  };
}
