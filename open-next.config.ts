// Cloudflare Workers build of the site (OpenNext). Vercel ignores this file.
import {
  defineCloudflareConfig,
  getCloudflareContext,
} from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";

import {
  type RequestContext,
  setRequestContext,
  withBackgroundSend,
  withColoCache,
  withColoPurge,
} from "./src/lib/colo-cache";

setRequestContext(
  () => getCloudflareContext() as unknown as ReturnType<RequestContext>,
);

const config = defineCloudflareConfig({
  // Pages and data-cache entries live in R2. Each Cloudflare location keeps
  // its own copy of a page in the Cache API and answers from that alone; a
  // location without one asks the server Worker, which runs next to R2
  // (src/lib/colo-cache.ts).
  incrementalCache: withColoCache(r2IncrementalCache),
  // Time-based revalidation, deduplicated across isolates, asked for after
  // the response.
  queue: withBackgroundSend(doQueue),
  // revalidateTag / revalidatePath. Only the server Worker asks (when it
  // reads a page from R2, rechecks a copy, or renders); answers, "never
  // revalidated" included, are kept in its location for a few seconds.
  tagCache: withColoPurge(
    doShardedTagCache({
      baseShardSize: 4,
      regionalCache: true,
      regionalCacheTtlSec: 5,
      regionalCacheDangerouslyPersistMissingTags: true,
    }),
  ),
  // Cached pages are answered without loading the Next.js server.
  enableCacheInterception: true,
});

// The Cloudflare build has no Next.js proxy: the Worker entry applies its
// rules itself (scripts/cf-drop-proxy.mjs says why).
config.buildCommand = "bun run build && node scripts/cf-drop-proxy.mjs";

// As on Vercel: a header a route sets itself wins over next.config.js
// headers() (for example /out's `Referrer-Policy: no-referrer`), and the
// proxy's headers win over the config's.
config.dangerous = {
  ...config.dangerous,
  headersAndCookiesPriority: () => "handler",
  middlewareHeadersOverrideNextConfigHeaders: true,
};

export default config;
