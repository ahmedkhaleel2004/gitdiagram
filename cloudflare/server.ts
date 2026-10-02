// The Next.js server on Cloudflare Workers: Worker `gitdiagram-server`
// (wrangler.server.jsonc). It has no address of its own. The site's Worker
// (cloudflare/worker.ts) calls it over a service binding for every request
// its routing layer and page cache could not answer: page renders, RSC
// payloads, the API routes. Requests arrive already routed, with the
// Vercel-style headers the entry Worker wrote.
//
// It runs in one place, next to Redis and R2 (`placement` in
// wrangler.server.jsonc), so it is also where a Cloudflare location without
// a copy of a cached page gets one (CACHE_ENTRY_PATH, src/lib/colo-cache.ts).

import { runWithCloudflareRequestContext } from "../.open-next/cloudflare/init.js";
import { handler } from "../.open-next/server-functions/default/handler.mjs";
import {
  CACHE_ENTRY_PATH,
  entryResponse,
  type EntrySource,
} from "../src/lib/colo-cache";
import "./outgoing-fetch";

interface Env {
  CRON_SECRET?: string;
}

const sameText = (given: string, wanted: string): boolean => {
  if (given.length !== wanted.length) return false;
  let difference = 0;
  for (let index = 0; index < given.length; index += 1)
    difference |= given.charCodeAt(index) ^ wanted.charCodeAt(index);
  return difference === 0;
};

/**
 * A cached page's entry for the routing Worker: 200 with the entry when the
 * tag cache calls it current, 404 when there is none or it was revalidated.
 * Only the routing Worker can reach this (it refuses the path to visitors),
 * and it must also present the shared secret.
 */
async function cacheEntry(request: Request, env: Env, url: URL) {
  const headers = { "Cache-Control": "no-store" };
  if (
    !env.CRON_SECRET ||
    !sameText(
      request.headers.get("authorization") ?? "",
      `Bearer ${env.CRON_SECRET}`,
    )
  )
    return new Response(null, { status: 403, headers });
  const key = url.searchParams.get("key");
  // OpenNext's incremental cache, which is src/lib/colo-cache.ts's wrapper.
  const cache = (globalThis as { incrementalCache?: Partial<EntrySource> })
    .incrementalCache;
  if (!key || !cache?.entryForLocation)
    return new Response(null, { status: 400, headers });
  const entry = await cache.entryForLocation(
    key,
    url.searchParams.has("fresh"),
  );
  return entry
    ? entryResponse(entry)
    : new Response(null, { status: 404, headers });
}

const server = {
  fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    return runWithCloudflareRequestContext(request, env, ctx, () => {
      const url = new URL(request.url);
      if (url.pathname === CACHE_ENTRY_PATH)
        return cacheEntry(request, env, url);
      return handler(request, env, ctx, request.signal);
    });
  },
};

export default server;
