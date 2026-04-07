export const SITEMAP_PAGE_SIZE = 45_000;
const STATIC_SITEMAP_ROUTE_COUNT = 2;

export function getSitemapCount(repoRouteCount: number) {
  const totalRouteCount = repoRouteCount + STATIC_SITEMAP_ROUTE_COUNT;
  return Math.max(1, Math.ceil(totalRouteCount / SITEMAP_PAGE_SIZE));
}

export function getSitemapUrls(siteUrl: string, sitemapCount: number) {
  return Array.from({ length: sitemapCount }, (_, id) => `${siteUrl}/sitemap/${id}.xml`);
}
