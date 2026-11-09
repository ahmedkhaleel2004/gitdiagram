import {
  buildRelatedShards,
  RELATED_SHARD_COUNT,
  type RelatedShard,
} from "~/features/browse/related";
import { readRequiredEnv } from "./config";
import { readBrowseIndex } from "./browse-diagrams";
import { getGzipJsonObject, putGzipJsonObject } from "./r2";

// The related-diagram shards in the public bucket (features/browse/related.ts
// says what they hold). Rebuilt once a day by the cron route
// /api/internal/related-diagrams, which may load the whole browse index.

const RELATED_SHARD_PREFIX = "public/v1/_meta/related/";
const WRITE_CONCURRENCY = 8;

function relatedShardKey(id: string): string {
  return `${RELATED_SHARD_PREFIX}${id}.json.gz`;
}

export function readRelatedShard(id: string): Promise<RelatedShard | null> {
  return getGzipJsonObject<RelatedShard>(
    readRequiredEnv("R2_PUBLIC_BUCKET"),
    relatedShardKey(id),
  );
}

/**
 * Rebuilds every shard from the browse index. A shard with nobody in it is
 * written empty, so a repository that left the index (or lost its language)
 * stops showing links. Returns how many repositories have related diagrams.
 */
export async function rebuildRelatedDiagrams(): Promise<{
  repositories: number;
  shards: number;
}> {
  const entries = await readBrowseIndex();
  if (!entries) throw new Error("Browse index missing.");
  const updatedAt = new Date().toISOString();
  const shards = buildRelatedShards(entries, updatedAt);
  const ids = Array.from({ length: RELATED_SHARD_COUNT }, (_, index) =>
    index.toString(16).padStart(2, "0"),
  );
  const bucket = readRequiredEnv("R2_PUBLIC_BUCKET");
  let repositories = 0;
  for (let start = 0; start < ids.length; start += WRITE_CONCURRENCY) {
    await Promise.all(
      ids.slice(start, start + WRITE_CONCURRENCY).map(async (id) => {
        const shard: RelatedShard = shards.get(id) ?? {
          version: 1,
          updatedAt,
          repositories: {},
        };
        repositories += Object.keys(shard.repositories).length;
        await putGzipJsonObject(bucket, relatedShardKey(id), shard);
      }),
    );
  }
  return { repositories, shards: ids.length };
}
