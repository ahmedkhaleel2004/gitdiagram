export const SITEMAP_PAGE_SIZE = 45_000;
// The fixed pages at the top of the first sitemap: /, /browse, /videos and
// /advertise (/videos only while explainer videos are on; at most one spare).
const STATIC_SITEMAP_ROUTE_COUNT = 4;

/**
 * How many sitemap pages hold `routeCount` listed pages (repositories and
 * video watch pages) plus the fixed ones. The sitemap's generateSitemaps is
 * the one caller; robots.txt lists what it returns.
 */
export function getSitemapCount(routeCount: number) {
  const totalRouteCount = routeCount + STATIC_SITEMAP_ROUTE_COUNT;
  return Math.max(1, Math.ceil(totalRouteCount / SITEMAP_PAGE_SIZE));
}

export function getSitemapUrls(siteUrl: string, sitemapCount: number) {
  return Array.from(
    { length: sitemapCount },
    (_, id) => `${siteUrl}/sitemap/${id}.xml`,
  );
}
