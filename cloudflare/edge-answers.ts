// The shared cache for route answers (see "The shared cache" in
// src/lib/cloudflare-edge.ts): what Vercel's CDN did for a route handler that
// answers with `s-maxage` or `CDN-Cache-Control`. Kept per Cloudflare
// location in the Cache API; a stale copy is answered at once and refreshed
// after the response.
import {
  EDGE_ANSWERS_CACHE,
  edgeAnswerKey,
  isSharedCacheRequest,
  sharedLifetime,
} from "../src/lib/cloudflare-edge";

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

const STORED_AT = "x-edge-stored-at";
const FRESH_FOR = "x-edge-fresh-for";
const VISITOR_CACHE_CONTROL = "x-edge-cache-control";
/** Says how an answer was served: HIT, STALE (refreshing) or MISS (kept now). */
export const EDGE_CACHE_HEADER = "x-edge-cache";

let opened: Promise<Cache> | undefined;
const answers = () => (opened ??= caches.open(EDGE_ANSWERS_CACHE));

// Refreshes under way in this isolate, so a burst of stale hits starts one.
const refreshing = new Set<string>();

// An answer with a cache tag is one Vercel's CDN was told to drop when its
// subject changed (a regenerated video). Here only the location that hears of
// the change drops its copy, so every location lets go of tagged answers soon.
const TAGGED_FRESH_SECONDS = 60;
const TAGGED_STALE_SECONDS = 600;

async function keep(key: string, response: Response): Promise<void> {
  const lifetime = sharedLifetime(response.status, response.headers);
  if (!lifetime) return;
  if (response.headers.has("vercel-cache-tag")) {
    lifetime.fresh = Math.min(lifetime.fresh, TAGGED_FRESH_SECONDS);
    lifetime.stale = Math.min(lifetime.stale, TAGGED_STALE_SECONDS);
  }
  const headers = new Headers(response.headers);
  headers.set(VISITOR_CACHE_CONTROL, headers.get("cache-control") ?? "");
  headers.set(STORED_AT, String(Date.now()));
  headers.set(FRESH_FOR, String(lifetime.fresh));
  // The Cache API's own lifetime for the copy: fresh, then stale.
  headers.set("cache-control", `max-age=${lifetime.fresh + lifetime.stale}`);
  const cache = await answers();
  await cache.put(key, new Response(response.body, { status: 200, headers }));
}

/**
 * Answers a cacheable API read from this location's copy when there is one,
 * else from `app`, keeping the answer if it names a shared lifetime.
 */
export async function withEdgeAnswers(
  request: Request,
  url: URL,
  ctx: Context,
  app: () => Promise<Response>,
): Promise<Response> {
  if (!isSharedCacheRequest(request.method, url.pathname, request.headers))
    return app();
  const key = edgeAnswerKey(url);
  let held: Response | undefined;
  try {
    held = await (await answers()).match(key);
  } catch {
    held = undefined;
  }
  const fetchAndKeep = async (): Promise<Response> => {
    const response = await app();
    if (!sharedLifetime(response.status, response.headers)) return response;
    const [visitor, copy] = response.body ? response.body.tee() : [null, null];
    ctx.waitUntil(
      keep(key, new Response(copy, response)).catch(() => undefined),
    );
    const answer = new Response(visitor, response);
    answer.headers.set(EDGE_CACHE_HEADER, "MISS");
    return answer;
  };
  if (!held) return fetchAndKeep();

  const headers = new Headers(held.headers);
  const storedAt = Number(headers.get(STORED_AT));
  const freshFor = Number(headers.get(FRESH_FOR));
  const age = Math.max(0, Math.floor((Date.now() - storedAt) / 1000));
  const stale = !(age <= freshFor);
  if (stale && !refreshing.has(key)) {
    refreshing.add(key);
    ctx.waitUntil(
      fetchAndKeep()
        .then((response) => response.body?.cancel())
        .catch(() => undefined)
        .finally(() => refreshing.delete(key)),
    );
  }
  headers.set("cache-control", headers.get(VISITOR_CACHE_CONTROL) ?? "");
  for (const name of [STORED_AT, FRESH_FOR, VISITOR_CACHE_CONTROL, "cache-tag"])
    headers.delete(name);
  headers.set("age", String(age));
  headers.set(EDGE_CACHE_HEADER, stale ? "STALE" : "HIT");
  return new Response(held.body, { status: 200, headers });
}
