import type { MetadataRoute } from "next";
import { getCachedBrowseIndex } from "~/app/browse/data";
import type { BrowseIndexEntry } from "~/features/browse/catalog";
import { SITE_URL } from "~/lib/site";
import { getSitemapCount, SITEMAP_PAGE_SIZE } from "~/lib/sitemaps";

function toValidDate(value: string): Date | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function getLatestBrowseUpdate(entries: BrowseIndexEntry[] | null): Date {
  return (
    entries
      ?.map((entry) => toValidDate(entry.lastSuccessfulAt))
      .find((date): date is Date => date !== null) ?? new Date()
  );
}

function getStaticRoutes(latestBrowseUpdate: Date): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/browse`,
      lastModified: latestBrowseUpdate,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];
}

export async function generateSitemaps() {
  const browseEntries = await getCachedBrowseIndex().catch(() => null);
  const sitemapCount = getSitemapCount(browseEntries?.length ?? 0);

  return Array.from({ length: sitemapCount }, (_, id) => ({ id }));
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number.parseInt(await props.id, 10);
  const sitemapId = Number.isFinite(id) && id >= 0 ? id : 0;
  const browseEntries = await getCachedBrowseIndex().catch(() => null);
  const latestBrowseUpdate =
    getLatestBrowseUpdate(browseEntries);

  const repoOffset = Math.max(0, sitemapId * SITEMAP_PAGE_SIZE - 2);
  const repoLimit = sitemapId === 0 ? SITEMAP_PAGE_SIZE - 2 : SITEMAP_PAGE_SIZE;
  const repoRoutes =
    browseEntries?.slice(repoOffset, repoOffset + repoLimit).map((entry) => ({
      url: `${SITE_URL}/${entry.username}/${entry.repo}`,
      lastModified: toValidDate(entry.lastSuccessfulAt) ?? latestBrowseUpdate,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })) ?? [];

  return sitemapId === 0
    ? [...getStaticRoutes(latestBrowseUpdate), ...repoRoutes]
    : repoRoutes;
}
