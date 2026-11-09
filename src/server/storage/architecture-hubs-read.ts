import "server-only";

import { unstable_cache } from "next/cache";
import type { HubIndex, HubPage } from "~/features/architecture-hubs/hubs";
import { errorText, logEvent } from "~/server/log";
import { readHubIndex, readHubPage } from "./architecture-hubs";

// The hubs change once a day; the rebuild drops every cached copy
// (ARCHITECTURE_HUBS_TAG), so six hours only bounds a missed rebuild.
const HUBS_REVALIDATE_SECONDS = 21600;
export const ARCHITECTURE_HUBS_TAG = "architecture-hubs";

const getCachedIndex = unstable_cache(
  () => readHubIndex(),
  ["architecture-hubs-index-v1"],
  { revalidate: HUBS_REVALIDATE_SECONDS, tags: [ARCHITECTURE_HUBS_TAG] },
);

function getCachedPage(slug: string, page: number) {
  return unstable_cache(
    () => readHubPage(slug, page),
    ["architecture-hubs-page-v1", slug, String(page)],
    { revalidate: HUBS_REVALIDATE_SECONDS, tags: [ARCHITECTURE_HUBS_TAG] },
  )();
}

/**
 * Every published hub, or null before the first rebuild. A failed read
 * throws (the page answers an error, never stand-in data or a 404).
 */
export async function readArchitectureHubs(): Promise<HubIndex | null> {
  try {
    const index = await getCachedIndex();
    return index?.version === 1 ? index : null;
  } catch (error) {
    logEvent("warn", "hubs.index_failed", { error: errorText(error) });
    throw error;
  }
}

async function readArchitectureHubPage(
  slug: string,
  page: number,
): Promise<HubPage | null> {
  try {
    const stored = await getCachedPage(slug, page);
    return stored?.version === 1 ? stored : null;
  } catch (error) {
    logEvent("warn", "hubs.page_failed", {
      slug,
      page,
      error: errorText(error),
    });
    throw error;
  }
}

/** A hub and one of its pages, or null when there is no such page. */
export async function loadArchitectureHub(slug: string, page: number) {
  if (!Number.isInteger(page) || page < 1) return null;
  const index = await readArchitectureHubs();
  const hub = index?.hubs.find((item) => item.slug === slug);
  if (!index || !hub || page > hub.pages) return null;
  const stored = await readArchitectureHubPage(slug, page);
  if (!stored) return null;
  return { index, hub, page: stored };
}
