import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { getCachedBrowseIndex } from "~/server/browse-index-cache";
import type { BrowseIndexEntry } from "~/features/browse/catalog";
import { SITE_URL } from "~/lib/site";
import { getSitemapCount, SITEMAP_PAGE_SIZE } from "~/lib/sitemaps";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { listStoredVideos } from "~/server/explainer/store";

// Watch pages render their video client-side, so the sitemap is how search
// engines find them. The list is small and changes slowly.
const MAX_VIDEO_ROUTES = 5_000;
const getVideoRoutes = unstable_cache(
  async (): Promise<MetadataRoute.Sitemap> => {
    if (!isVideoExplainerEnabled()) return [];
    const videos = await listStoredVideos();
    return videos.slice(0, MAX_VIDEO_ROUTES).map((video) => ({
      url: `${SITE_URL}/${video.owner}/${video.repo}/video`,
      lastModified: video.updatedAt ?? new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));
  },
  ["sitemap-video-routes"],
  { revalidate: 3600 },
);

function toValidDate(value: string): Date | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function getLatestBrowseUpdate(entries: BrowseIndexEntry[] | null): Date {
  for (const entry of entries ?? []) {
    const date = toValidDate(entry.lastSuccessfulAt);
    if (date) {
      return date;
    }
  }

  return new Date();
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
    {
      url: `${SITE_URL}/advertise`,
      lastModified: new Date("2026-09-19"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}

export async function generateSitemaps() {
  const browseEntries = await getCachedBrowseIndex().catch(() => null);
  const videoRoutes = await getVideoRoutes().catch(() => []);
  const sitemapCount = getSitemapCount(
    (browseEntries?.length ?? 0) + videoRoutes.length,
  );

  return Array.from({ length: sitemapCount }, (_, id) => ({ id }));
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number.parseInt(await props.id, 10);
  const sitemapId = Number.isFinite(id) && id >= 0 ? id : 0;
  const browseEntries = await getCachedBrowseIndex().catch(() => null);
  const latestBrowseUpdate = getLatestBrowseUpdate(browseEntries);
  // Video watch pages ride on the first page, after the fixed routes.
  const staticRoutes = [
    ...getStaticRoutes(latestBrowseUpdate),
    ...(await getVideoRoutes().catch(() => [])),
  ];

  const staticRouteCount = staticRoutes.length;
  const repoOffset = Math.max(
    0,
    sitemapId * SITEMAP_PAGE_SIZE - staticRouteCount,
  );
  const repoLimit =
    sitemapId === 0 ? SITEMAP_PAGE_SIZE - staticRouteCount : SITEMAP_PAGE_SIZE;
  const repoRoutes =
    browseEntries?.slice(repoOffset, repoOffset + repoLimit).map((entry) => ({
      url: `${SITE_URL}/${entry.username}/${entry.repo}`,
      lastModified: toValidDate(entry.lastSuccessfulAt) ?? latestBrowseUpdate,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })) ?? [];

  return sitemapId === 0 ? [...staticRoutes, ...repoRoutes] : repoRoutes;
}
