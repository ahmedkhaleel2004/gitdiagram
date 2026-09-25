import "server-only";

import { unstable_cache } from "next/cache";
import { listStoredVideos, readVideoArtifact } from "./store";

/** What a video card on /videos shows. */
export interface VideoCard {
  owner: string;
  repo: string;
  title: string;
  /** The first line of narration: what the project is. */
  opening: string;
  durationSeconds: number;
  stars: number;
  language: string;
  createdAt: string;
}

const MAX_VIDEOS = 300;

async function loadCatalog(): Promise<VideoCard[]> {
  const stored = (await listStoredVideos()).slice(0, MAX_VIDEOS);
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
    for (const video of batch) {
      if (!video) continue;
      cards.push({
        owner: video.meta.owner,
        repo: video.meta.repo,
        title: video.plan.title,
        opening: video.plan.beats[0]?.narration ?? "",
        durationSeconds: Math.round(video.timing.DURATION),
        stars: video.meta.stars,
        language: video.meta.language,
        createdAt: video.createdAt,
      });
    }
  }
  // Newest first, as listed; /videos sorts and filters on the client.
  return cards;
}

export const getVideoCatalog = unstable_cache(
  loadCatalog,
  ["explainer-video-catalog"],
  { revalidate: 300 },
);
