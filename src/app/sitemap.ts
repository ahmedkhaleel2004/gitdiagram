import type { MetadataRoute } from "next";
import { getCachedBrowseIndex } from "~/app/browse/data";
import { SITE_URL } from "~/lib/site";

function toValidDate(value: string): Date | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const browseEntries = await getCachedBrowseIndex().catch(() => null);
  const latestBrowseUpdate =
    browseEntries
      ?.map((entry) => toValidDate(entry.lastSuccessfulAt))
      .find((date): date is Date => date !== null) ?? new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
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

  const repoRoutes =
    browseEntries?.map((entry) => ({
      url: `${SITE_URL}/${entry.username}/${entry.repo}`,
      lastModified: toValidDate(entry.lastSuccessfulAt) ?? latestBrowseUpdate,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })) ?? [];

  return [...staticRoutes, ...repoRoutes];
}
