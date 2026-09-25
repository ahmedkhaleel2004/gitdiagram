export const SITEMAP_PAGE_SIZE = 45_000;

/**
 * How many sitemap pages hold `routeCount` listed pages (repositories and
 * video watch pages) plus the `fixedRouteCount` fixed ones at the top of the
 * first page (/, /browse, /advertise, and /videos while videos are on). The
 * sitemap's generateSitemaps is the one caller; robots.txt lists what it
 * returns.
 */
export function getSitemapCount(routeCount: number, fixedRouteCount: number) {
  return Math.max(
    1,
    Math.ceil((routeCount + fixedRouteCount) / SITEMAP_PAGE_SIZE),
  );
}

export function getSitemapUrls(siteUrl: string, sitemapCount: number) {
  return Array.from(
    { length: sitemapCount },
    (_, id) => `${siteUrl}/sitemap/${id}.xml`,
  );
}
