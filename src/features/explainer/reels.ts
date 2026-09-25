import { fetchExplainerVideo } from "./api";
import type { VideoCard } from "./catalog-types";
import type { VideoArtifact } from "./types";

// Reels: every stored video in a vertical feed, one screen each.

export const reelKey = (card: { owner: string; repo: string }) =>
  `${card.owner.toLowerCase()}/${card.repo.toLowerCase()}`;

/** The feed opened on one video: what the share button hands out. */
export function reelPath(card: { owner: string; repo: string }): string {
  return `/reels?v=${encodeURIComponent(`${card.owner}/${card.repo}`)}`;
}

/** The video a reels link opens on (`?v=owner/repo`), if it names one. */
export function parseReelParam(
  value: string | null,
): { owner: string; repo: string } | null {
  // GitHub's own rules: owners are letters, digits and inner hyphens;
  // repositories add dots and underscores, but are never "." or "..".
  const match =
    /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/((?!\.{1,2}$)[\w.-]{1,100})$/.exec(
      value ?? "",
    );
  return match ? { owner: match[1]!, repo: match[2]! } : null;
}

/** The card a video's own data makes, for a video opened by link. */
export function cardOf(video: VideoArtifact): VideoCard {
  return {
    owner: video.meta.owner,
    repo: video.meta.repo,
    title: video.plan.title,
    opening: video.plan.beats[0]?.narration ?? "",
    durationSeconds: Math.round(video.timing.DURATION),
    stars: video.meta.stars,
    language: video.meta.language,
    createdAt: video.createdAt,
  };
}

/** A fresh order for a page of cards, so the feed is not a ranked list. */
export function shuffled<T>(items: T[], random = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Cards not already in the feed, in their own order. */
export function newCards(feed: VideoCard[], more: VideoCard[]): VideoCard[] {
  const seen = new Set(feed.map(reelKey));
  return more.filter((card) => {
    const key = reelKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Videos asked for once per page view: the reel on screen and the next few
// share one request each. A failed read is forgotten, so a retry asks again.
const videos = new Map<string, Promise<VideoArtifact | null>>();

export function loadReelVideo(card: {
  owner: string;
  repo: string;
}): Promise<VideoArtifact | null> {
  const key = reelKey(card);
  let pending = videos.get(key);
  if (!pending) {
    pending = fetchExplainerVideo(card.owner, card.repo).then(
      (state) => state.video,
    );
    pending.catch(() => videos.delete(key));
    videos.set(key, pending);
  }
  return pending;
}

/** The feed's sound output: one context, unlocked by the first tap, and a mute. */
export interface ReelOutput {
  context: AudioContext;
  /** Where every reel's mix goes; its gain is the mute. */
  destination: GainNode;
}

let output: ReelOutput | null = null;

/** The page's one reel output, made the first time it is asked for. */
export function reelOutput(): ReelOutput {
  if (!output) {
    const context = new AudioContext();
    const destination = context.createGain();
    destination.connect(context.destination);
    output = { context, destination };
  }
  return output;
}
