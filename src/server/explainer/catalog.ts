import "server-only";

import { unstable_cache } from "next/cache";
import type { VideoCard } from "~/features/explainer/catalog-types";
import { VIDEO_CATALOG_TAG } from "./cache";
import {
  listStoredVideos,
  readVideoArtifact,
  videoStoreBackend,
} from "./store";
import { fillVideoIndex, readVideoIndex, videoCard } from "./video-index";

export type { VideoCard };

/** Every stored video's card, read from storage itself: slow, but complete. */
async function cardsFromStorage(): Promise<VideoCard[]> {
  const stored = await listStoredVideos();
  const cards: VideoCard[] = [];
  // Read artifacts a batch at a time rather than all at once.
  for (let start = 0; start < stored.length; start += 16) {
    const batch = await Promise.all(
      stored
        .slice(start, start + 16)
        .map((video) =>
          readVideoArtifact(video.owner, video.repo).catch(() => null),
        ),
    );
    for (const video of batch) if (video) cards.push(videoCard(video));
  }
  return cards;
}

const newestFirst = (cards: VideoCard[]) =>
  cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const logIndexFailure = (event: string, error: unknown) =>
  console.error(
    JSON.stringify({
      event,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    }),
  );

/**
 * Every stored video, newest first (/videos sorts and filters on the client).
 * Production reads the Redis index; the first read builds it from R2, and if
 * Redis is down the gallery still lists everything from R2.
 */
export async function listVideoCards(): Promise<VideoCard[]> {
  if (videoStoreBackend() !== "r2")
    return newestFirst(await cardsFromStorage());
  let indexed: VideoCard[] | null;
  try {
    indexed = await readVideoIndex();
  } catch (error) {
    logIndexFailure("video.index_read_failed", error);
    return newestFirst(await cardsFromStorage());
  }
  if (indexed) return newestFirst(indexed);
  const cards = await cardsFromStorage();
  await fillVideoIndex(cards).catch((error: unknown) =>
    logIndexFailure("video.index_fill_failed", error),
  );
  return newestFirst(cards);
}

export const getVideoCatalog = unstable_cache(
  listVideoCards,
  [VIDEO_CATALOG_TAG],
  { revalidate: 300, tags: [VIDEO_CATALOG_TAG] },
);
