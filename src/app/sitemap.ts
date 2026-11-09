import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import {
  getCachedBrowseIndex,
  getCachedBrowseIndexTotal,
} from "~/server/browse-index-cache";
import type { BrowseIndexEntry } from "~/features/browse/catalog";
import {
  COMPARE_CHECKED,
  COMPARE_PAGES,
  ROUNDUP_PATH,
  comparePath,
} from "~/features/compare/content";
import {
  REPORT_PATH,
  REPORT_PUBLISHED,
} from "~/features/architecture-report/content";
import { POPULAR, POPULAR_PATH } from "~/features/popular-repos/content";
import { GUIDE_UPDATED } from "~/features/guide/content";
import {
  SITUATIONS_CHECKED,
  SITUATION_PAGES,
  situationPath,
} from "~/features/situations/content";
import { SITE_URL } from "~/lib/site";
import {
  getSitemapCount,
  mostStarredEntries,
  POPULAR_SITEMAP_COUNT,
  SITEMAP_PAGE_SIZE,
} from "~/lib/sitemaps";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { listVideoCards } from "~/server/explainer/catalog";

// Watch pages render their video client-side, so the sitemap is how search
// engines find them. The list is small and changes slowly.
const MAX_VIDEO_ROUTES = 5_000;
const getVideoRoutes = unstable_cache(
  async (): Promise<MetadataRoute.Sitemap> => {
    if (!isVideoExplainerEnabled()) return [];
    const videos = await listVideoCards();
    return videos.slice(0, MAX_VIDEO_ROUTES).map((video) => ({
      url: `${SITE_URL}/${video.owner.toLowerCase()}/${video.repo.toLowerCase()}/video`,
      lastModified: video.createdAt,
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
      lastModified: latestBrowseUpdate,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/browse`,
      lastModified: latestBrowseUpdate,
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...(isVideoExplainerEnabled()
      ? [
          {
            url: `${SITE_URL}/videos`,
            lastModified: latestBrowseUpdate,
            changeFrequency: "daily" as const,
            priority: 0.8,
          },
          {
            url: `${SITE_URL}/reels`,
            lastModified: latestBrowseUpdate,
            changeFrequency: "daily" as const,
            priority: 0.6,
          },
        ]
      : []),
    {
      url: `${SITE_URL}/visualize-codebase`,
      lastModified: new Date(GUIDE_UPDATED),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}${ROUNDUP_PATH}`,
      lastModified: new Date(COMPARE_CHECKED),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    ...COMPARE_PAGES.map((page) => ({
      url: `${SITE_URL}${comparePath(page.slug)}`,
      lastModified: new Date(COMPARE_CHECKED),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...SITUATION_PAGES.map((page) => ({
      url: `${SITE_URL}${situationPath(page.slug)}`,
      lastModified: new Date(SITUATIONS_CHECKED),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    {
      url: `${SITE_URL}${REPORT_PATH}`,
      lastModified: new Date(REPORT_PUBLISHED),
      changeFrequency: "yearly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}${POPULAR_PATH}`,
      lastModified: new Date(POPULAR.checked),
      changeFrequency: "weekly",
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

// Only a count is needed here, and robots.txt calls this on the placed
// server, which must never hold the whole index (CLAUDE.md, the 128 MB rule).
export async function generateSitemaps() {
  const browseTotal = await getCachedBrowseIndexTotal().catch(() => null);
  const videoRoutes = await getVideoRoutes().catch(() => []);
  const sitemapCount = getSitemapCount(
    (browseTotal ?? 0) + videoRoutes.length,
    getStaticRoutes(new Date()).length,
  );

  return Array.from({ length: sitemapCount }, (_, id) => ({ id }));
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number.parseInt(await props.id, 10);
  const sitemapId = Number.isFinite(id) && id >= 0 ? id : 0;
  const browseEntries = (await getCachedBrowseIndex().catch(() => null)) ?? [];
  const latestBrowseUpdate = getLatestBrowseUpdate(browseEntries);
  const repoRoute = (entry: BrowseIndexEntry, priority: number) => ({
    url: `${SITE_URL}/${entry.username}/${entry.repo}`,
    lastModified: toValidDate(entry.lastSuccessfulAt) ?? latestBrowseUpdate,
    changeFrequency: "monthly" as const,
    priority,
  });

  // The order of every listed page across all shards: the fixed routes, the
  // most-starred repositories, the video watch pages, then every other
  // repository in the index's order. Each shard is one slice of it.
  const popular = mostStarredEntries(browseEntries, POPULAR_SITEMAP_COUNT);
  const popularKeys = new Set(
    popular.map((entry) => `${entry.username}/${entry.repo}`),
  );
  const head: MetadataRoute.Sitemap = [
    ...getStaticRoutes(latestBrowseUpdate),
    ...popular.map((entry) => repoRoute(entry, 0.7)),
    ...(await getVideoRoutes().catch(() => [])),
  ];
  const start = sitemapId * SITEMAP_PAGE_SIZE;
  const end = start + SITEMAP_PAGE_SIZE;
  const routes = head.slice(start, end);
  if (routes.length < SITEMAP_PAGE_SIZE) {
    // Walk the rest of the index only as far as this shard reaches.
    let position = head.length;
    for (const entry of browseEntries) {
      if (popularKeys.has(`${entry.username}/${entry.repo}`)) continue;
      if (position >= end) break;
      if (position >= start) routes.push(repoRoute(entry, 0.5));
      position += 1;
    }
  }
  return routes;
}
