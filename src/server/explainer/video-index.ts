import "server-only";

import type { VideoCard } from "~/features/explainer/catalog-types";
import type { VideoArtifact } from "~/features/explainer/types";
import { upstashCommand, upstashEval } from "~/server/storage/upstash";

// /videos and the sitemap list every stored video. Finding them in R2 meant
// listing every object under video/v1/ (about twenty per video) and then
// reading every artifact, so a Redis hash keeps one card per repository
// instead, written whenever a video or its poster is stored. The hash is
// built once from R2 (see catalog.ts); the ready key says that has happened.
// Only production storage is indexed: local videos never reach this Redis.

const INDEX_KEY = "video:v1:index";
const READY_KEY = "video:v1:index:ready";

const field = (owner: string, repo: string) =>
  `${owner.toLowerCase()}/${repo.toLowerCase()}`;

/** A video's gallery card. */
export function videoCard(
  artifact: VideoArtifact,
  posterAt?: number,
): VideoCard {
  return {
    // First, so the write script can read it back from the stored JSON.
    createdAt: artifact.createdAt,
    owner: artifact.meta.owner,
    repo: artifact.meta.repo,
    title: artifact.plan.title,
    opening: artifact.plan.beats[0]?.narration ?? "",
    durationSeconds: Math.round(artifact.timing.DURATION),
    stars: artifact.meta.stars,
    language: artifact.meta.language,
    ...(posterAt ? { posterAt } : {}),
  };
}

// ARGV: a mode, then (field, card JSON, createdAt) triples. "replace" writes
// a card unless the stored one is for a newer version (ISO times compare as
// strings), so a late write for a replaced video never wins; "missing" only
// fills repositories with no card yet, so building the index never
// overwrites a card written meanwhile.
const WRITE_SCRIPT = `
local written = 0
for index = 2, #ARGV, 3 do
  local current = redis.call("HGET", KEYS[1], ARGV[index])
  local write = not current
  if current and ARGV[1] == "replace" then
    local stored = string.match(current, '"createdAt":"([^"]*)"')
    write = not stored or stored <= ARGV[index + 2]
  end
  if write then
    redis.call("HSET", KEYS[1], ARGV[index], ARGV[index + 1])
    written = written + 1
  end
end
return written
`;

function writeCards(cards: VideoCard[], mode: "replace" | "missing") {
  return upstashEval<number>({
    script: WRITE_SCRIPT,
    keys: [INDEX_KEY],
    args: [
      mode,
      ...cards.flatMap((card) => [
        field(card.owner, card.repo),
        JSON.stringify(card),
        card.createdAt,
      ]),
    ],
  });
}

/**
 * Add or update a video's card (with when its poster was made, once it has
 * one). Never throws: a missing card only hides the video from the gallery
 * until the next write.
 */
export async function indexVideo(
  artifact: VideoArtifact,
  options: { posterAt?: number } = {},
): Promise<void> {
  try {
    await writeCards([videoCard(artifact, options.posterAt)], "replace");
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "video.index_write_failed",
        repository: artifact.repository,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
  }
}

/** Every indexed card, or null while the index has not been built. Throws if Redis fails. */
export async function readVideoIndex(): Promise<VideoCard[] | null> {
  if ((await upstashCommand<string | null>(["GET", READY_KEY])) !== "1")
    return null;
  const values = await upstashCommand<string[]>(["HVALS", INDEX_KEY]);
  return values.flatMap((value) => {
    try {
      return [JSON.parse(value) as VideoCard];
    } catch {
      return [];
    }
  });
}

/** Build the index from cards read out of storage, then mark it ready. */
export async function fillVideoIndex(cards: VideoCard[]): Promise<void> {
  for (let start = 0; start < cards.length; start += 100)
    await writeCards(cards.slice(start, start + 100), "missing");
  await upstashCommand(["SET", READY_KEY, "1"]);
}
