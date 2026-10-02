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
  ENTRY_WANTED,
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
 * GET: a cached page's entry for a location rechecking its copy: 200 with
 * the entry when the tag cache calls it current, 404 when there is none or
 * it was revalidated. POST `{ drop: [keys] }`: this location's copies of
 * pages just revalidated somewhere else are removed.
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
  // A page was revalidated in another location: this one's copy goes too.
  if (request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      drop?: unknown;
    } | null;
    const keys = Array.isArray(body?.drop)
      ? body.drop.filter((key): key is string => typeof key === "string")
      : [];
    await entries()?.dropCopies?.(keys.slice(0, 50));
    return new Response(null, { status: 204, headers });
  }
  const key = url.searchParams.get("key");
  const cache = entries();
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

// OpenNext's incremental cache, which is src/lib/colo-cache.ts's wrapper.
const entries = () =>
  (globalThis as { incrementalCache?: Partial<EntrySource> }).incrementalCache;

const server = {
  fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    return runWithCloudflareRequestContext(request, env, ctx, async () => {
      const url = new URL(request.url);
      if (url.pathname === CACHE_ENTRY_PATH)
        return cacheEntry(request, env, url);
      // The visitor's location had no copy of this page. A current entry
      // here is the whole answer (the routing Worker turns it into the
      // page); without one the request is rendered as any other.
      const wanted = request.headers.get(ENTRY_WANTED);
      if (wanted && request.method === "GET") {
        const entry = await entries()
          ?.entryForLocation?.(wanted, false)
          .catch(() => null);
        if (entry) return entryResponse(entry);
      }
      return handler(request, env, ctx, request.signal);
    });
  },
};

export default server;
