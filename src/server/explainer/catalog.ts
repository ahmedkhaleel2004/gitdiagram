import "server-only";

import { unstable_cache } from "next/cache";
import {
  getBrowsePageFromPreparedIndex,
  prepareBrowseIndex,
  type BrowseQuery,
  type PreparedBrowseIndex,
} from "~/features/browse/catalog";
import {
  VIDEO_PAGE_SIZE,
  type VideoCard,
  type VideoPage,
} from "~/features/explainer/catalog-types";
import { errorText, logEvent } from "~/server/log";
import { VIDEO_CATALOG_TAG } from "./cache";
import {
  listStoredVideos,
  readVideoArtifact,
  renderStamp,
  videoStoreBackend,
} from "./store";
import {
  claimVideoIndexBuild,
  fillVideoIndex,
  readVideoIndex,
  videoCard,
} from "./video-index";

export type { VideoCard };

/**
 * Every stored video's card, read from storage itself: slow, but complete
 * unless an artifact could not be read (`complete` says whether all were).
 */
async function cardsFromStorage(): Promise<{
  cards: VideoCard[];
  complete: boolean;
}> {
  const stored = await listStoredVideos();
  const cards: VideoCard[] = [];
  let complete = true;
  // Read artifacts a batch at a time rather than all at once.
  for (let start = 0; start < stored.length; start += 16) {
    const batch = await Promise.all(
      stored.slice(start, start + 16).map(async ({ owner, repo }) => {
        try {
          const video = await readVideoArtifact(owner, repo);
          if (!video) return null;
          // The gallery names the still by when it was made, so a later
          // remake gets a fresh URL (see indexVideo's posterAt).
          const posterAt = await renderStamp(video, "still.jpg").catch(
            () => null,
          );
          return videoCard(video, posterAt ?? undefined);
        } catch {
          complete = false;
          return null;
        }
      }),
    );
    for (const card of batch) if (card) cards.push(card);
  }
  return { cards, complete };
}

const newestFirst = (cards: VideoCard[]) =>
  cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/**
 * Every stored video, newest first. Production reads the Redis index; until
 * it has been built completely, one caller at a time builds it from R2 (the
 * others list what is indexed so far), and if Redis is down the list comes
 * from R2 itself. Throws when neither can be read.
 */
export async function listVideoCards(): Promise<VideoCard[]> {
  if (videoStoreBackend() !== "r2")
    return newestFirst((await cardsFromStorage()).cards);
  let indexed: Awaited<ReturnType<typeof readVideoIndex>>;
  try {
    indexed = await readVideoIndex();
  } catch (error) {
    logEvent("error", "video.index_read_failed", { error: errorText(error) });
    return newestFirst((await cardsFromStorage()).cards);
  }
  if (indexed.ready) return newestFirst(indexed.cards);
  const building = await claimVideoIndexBuild().catch(() => false);
  if (!building) {
    // Another caller is building it, or a build failed moments ago. With
    // nothing indexed yet, failing keeps the last good gallery on show.
    if (!indexed.cards.length)
      throw new Error("The video index is being built.");
    return newestFirst(indexed.cards);
  }
  const { cards, complete } = await cardsFromStorage();
  if (!complete)
    logEvent("warn", "video.index_fill_incomplete", { cards: cards.length });
  await fillVideoIndex(cards, { complete }).catch((error: unknown) =>
    logEvent("error", "video.index_fill_failed", { error: errorText(error) }),
  );
  // Cards stored while this build ran are in the index, not in this read.
  const listed = new Set(cards.map((card) => cardKey(card)));
  return newestFirst([
    ...cards,
    ...indexed.cards.filter((card) => !listed.has(cardKey(card))),
  ]);
}

const cardKey = (card: VideoCard) =>
  `${card.owner.toLowerCase()}/${card.repo.toLowerCase()}`;

type VideoEntry = {
  username: string;
  repo: string;
  lastSuccessfulAt: string;
  stargazerCount: number;
  card: VideoCard;
};

function prepareCatalog(cards: VideoCard[]): PreparedBrowseIndex<VideoEntry> {
  return prepareBrowseIndex(
    cards.map((card) => ({
      username: card.owner,
      repo: card.repo,
      lastSuccessfulAt: card.createdAt,
      stargazerCount: card.stars,
      card,
    })),
    "recent_desc",
  );
}

// The gallery's pages come from one list per instance, read at most once a
// minute, so paging and searching never read the whole index per request.
const CATALOG_TTL_MS = 60_000;
let catalog: {
  index: PreparedBrowseIndex<VideoEntry>;
  expiresAt: number;
} | null = null;
let catalogRead: Promise<PreparedBrowseIndex<VideoEntry>> | null = null;

function cachedCatalog(): Promise<PreparedBrowseIndex<VideoEntry>> {
  if (catalog && catalog.expiresAt > Date.now())
    return Promise.resolve(catalog.index);
  catalogRead ??= listVideoCards()
    .then((cards) => {
      const index = prepareCatalog(cards);
      catalog = { index, expiresAt: Date.now() + CATALOG_TTL_MS };
      return index;
    })
    .finally(() => {
      catalogRead = null;
    });
  return catalogRead;
}

function toVideoPage(
  index: PreparedBrowseIndex<VideoEntry>,
  query: BrowseQuery,
): VideoPage {
  const { items, ...page } = getBrowsePageFromPreparedIndex(
    index,
    query,
    VIDEO_PAGE_SIZE,
  );
  return { ...page, cards: items.map((item) => item.card) };
}

/**
 * One page of the gallery, searched, filtered and sorted like /browse.
 * Throws when the videos cannot be listed.
 */
export async function getVideoPage(query: BrowseQuery): Promise<VideoPage> {
  return toVideoPage(await cachedCatalog(), query);
}

/**
 * The gallery's first page, newest first, for the statically rendered
 * /videos. Read fresh, and dropped with VIDEO_CATALOG_TAG when a video is
 * stored. Only one page is cached, so the entry stays small however many
 * videos there are.
 */
export const getFirstVideoPage = unstable_cache(
  async () => toVideoPage(prepareCatalog(await listVideoCards()), {}),
  ["explainer-video-first-page"],
  { revalidate: 300, tags: [VIDEO_CATALOG_TAG] },
);

/** Forget this instance's list (tests). */
export function resetVideoCatalogForTests(): void {
  catalog = null;
  catalogRead = null;
}
