import { toRepoKey } from "~/features/browse/catalog";
import {
  buildRelatedShards,
  mergeRelatedShard,
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
 * Rebuilds every shard from the browse index, merged over the stored one
 * (mergeRelatedShard): a page keeps its line until a new list replaces it, so
 * a rebuild from a partly back-filled index never empties a shard. A
 * repository that left the index drops out. A shard that cannot be read is
 * not written at all. Returns how many repositories have related diagrams.
 */
export async function rebuildRelatedDiagrams(): Promise<{
  repositories: number;
  shards: number;
}> {
  const entries = await readBrowseIndex();
  if (!entries) throw new Error("Browse index missing.");
  const updatedAt = new Date().toISOString();
  const shards = buildRelatedShards(entries, updatedAt);
  const indexed = new Set(entries.map(toRepoKey));
  const ids = Array.from({ length: RELATED_SHARD_COUNT }, (_, index) =>
    index.toString(16).padStart(2, "0"),
  );
  const bucket = readRequiredEnv("R2_PUBLIC_BUCKET");
  let repositories = 0;
  let failed = 0;
  for (let start = 0; start < ids.length; start += WRITE_CONCURRENCY) {
    await Promise.allSettled(
      ids.slice(start, start + WRITE_CONCURRENCY).map(async (id) => {
        // A failed read throws: the shard is left as it is.
        const stored = await readRelatedShard(id);
        const shard = mergeRelatedShard(
          shards.get(id),
          stored,
          indexed,
          updatedAt,
        );
        await putGzipJsonObject(bucket, relatedShardKey(id), shard);
        repositories += Object.keys(shard.repositories).length;
      }),
    ).then((results) => {
      failed += results.filter((result) => result.status === "rejected").length;
    });
  }
  if (failed > 0) {
    throw new Error(
      `${failed} related shards failed; the others were written.`,
    );
  }
  return { repositories, shards: ids.length };
}
