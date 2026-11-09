// About 177 bytes a listed page, so a shard of 8,000 is about 1.4 MB: under
// the size each Cloudflare location keeps a copy of (MAX_COPY_CHARS in
// colo-cache.ts), so shards answer from a nearby copy instead of the placed
// server. At 45,000 a shard was 8 MB and took 2 to 4 s to start answering
// when not cached. Search engines take up to 50,000 a file.
export const SITEMAP_PAGE_SIZE = 8_000;

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
