// Cloudflare Workers build of the site (OpenNext). Vercel ignores this file.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";

export default defineCloudflareConfig({
  // Pages and data-cache entries live in R2; each Cloudflare location keeps
  // its own copy in the Cache API so a repeat hit does not read R2.
  incrementalCache: withRegionalCache(r2IncrementalCache, {
    mode: "long-lived",
  }),
  // Time-based revalidation, deduplicated across isolates.
  queue: doQueue,
  // revalidateTag / revalidatePath. Lookups are cached per location for a
  // few seconds, so a purge reaches every visitor within that time.
  tagCache: doShardedTagCache({
    baseShardSize: 4,
    regionalCache: true,
    regionalCacheTtlSec: 5,
  }),
  // Cached pages are answered without loading the Next.js server.
  enableCacheInterception: true,
});
