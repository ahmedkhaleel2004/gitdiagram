// The page cache on Cloudflare: a copy of each cached page in every
// Cloudflare location, and the wrappers that go with it
// (open-next.config.ts wires them in). Only the Cloudflare build uses this.
//
// Cached pages live in R2, one bucket for the world, and whether one is
// still valid is a question for the tag cache (Durable Objects). Asked on
// every request, those two round trips are most of a cached page's response
// time, and from another continent each is several hundred milliseconds.
// So the cache has three levels:
//
// 1. Every location keeps its own copy of a page in the Cache API and
//    answers from it alone. A copy is trusted for RECHECK_MS; a hit on an
//    older one is still answered at once, and the copy is brought in line
//    after the response (replaced, or dropped if the page was revalidated).
// 2. A location without a copy sends the request on to the server Worker
//    marked "entry wanted" (ENTRY_WANTED): if the server has a current entry
//    it answers with that (gzipped) instead of rendering, and the location
//    keeps it and answers from it. One round trip to where the server runs,
//    next to R2 and the tag cache, instead of two long ones from the
//    visitor's side of the world; and a page nobody has cached costs no extra
//    trip, the server just renders it. The server answers from its own
//    location's copies, which hold every page the world has asked for.
// 3. The server reads R2 and asks the tag cache.
//
// Freshness: `revalidatePath` drops the copy where it runs and the copy
// where the server runs at once, so whoever changed a page gets it rendered
// on their next request (not the old page first); a copy in another location
// follows within RECHECK_MS + FRESH_WITHIN_MS plus one request. A copy is only
// ever made of an entry the tag cache calls current, so an invalidated page
// never comes back out of R2 into a location.
//
// OpenNext's own `withRegionalCache` reads R2 on every hit instead (its
// "lazy update") and still asks the tag cache each time.
import type {
  CacheEntryType,
  CacheValue,
  IncrementalCache,
  NextModeTagCache,
  Queue,
  WithLastModified,
} from "@opennextjs/aws/types/overrides.js";

interface ServerBinding {
  fetch(request: Request): Promise<Response>;
}

/**
 * What the wrappers need from the Worker runtime: the request in progress
 * (work may continue after its response through `waitUntil`) and the
 * Worker's bindings. OpenNext's `getCloudflareContext()` has this shape.
 */
export type RequestContext = () => {
  ctx: { waitUntil(promise: Promise<unknown>): void };
  env: {
    /** The server Worker, bound in the routing Worker only. */
    SERVER?: ServerBinding;
    /**
     * The server Worker next to the data, bound in both server Workers: the
     * one whose copies every location without its own is answered from.
     */
    PLACED_SERVER?: ServerBinding;
    SERVER_VERSION_OVERRIDE?: string;
    SITE_ORIGIN?: string;
    CRON_SECRET?: string;
  };
};

let requestContext: RequestContext = () => {
  throw new Error("The colo cache has no request context.");
};

/** Set once by open-next.config.ts. */
export function setRequestContext(context: RequestContext): void {
  requestContext = context;
}

/**
 * Where the server Worker hands out cache entries to a location rechecking
 * its copy (cloudflare/server.ts).
 */
export const CACHE_ENTRY_PATH = "/__gitdiagram/cache-entry";
/**
 * On a request the routing Worker forwards: "this location has no copy of
 * this page's entry; answer with the entry if you have a current one". The
 * value is the entry's key.
 */
export const ENTRY_WANTED = "x-gitdiagram-entry-wanted";
/**
 * On a request the edge Worker sends straight to the server Worker: it has
 * not been through OpenNext's routing layer, so the server runs it.
 */
export const UNROUTED = "x-gitdiagram-unrouted";
/**
 * An entry is 60 to 400 KB of JSON and crosses an ocean on its way to the
 * asking location, on a connection that is often new: every doubling of the
 * congestion window is another round trip. The server gzips it (to about a
 * fifth) and says so in this header rather than `Content-Encoding`, which
 * the runtime would act on by itself.
 */
export const ENTRY_ENCODING = "x-gitdiagram-entry-encoding";

/** An entry as the server Worker sends it to another location. */
export function entryResponse(entry: CurrentEntry): Response {
  const json = new Response(JSON.stringify(entry)).body!;
  return new Response(json.pipeThrough(new CompressionStream("gzip")), {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      [ENTRY_ENCODING]: "gzip",
    },
  });
}

/** How long a location's copy is served without checking it again. */
const RECHECK_MS = 30_000;
/**
 * How recently the server's location must have checked its own copy to hand
 * it to a location that is rechecking. A page is therefore never older than
 * RECHECK_MS + FRESH_WITHIN_MS plus one request after it was revalidated.
 */
const FRESH_WITHIN_MS = 10_000;
/**
 * How long the Cache API may keep a copy nobody asks for. Copies in use are
 * rewritten at every recheck; the Cache API evicts cold ones sooner anyway.
 */
const KEEP_SECONDS = 24 * 60 * 60;
const CACHE_NAME = "page-cache";
const SOFT_TAG_PREFIX = "_N_T_";

interface Copy {
  value: unknown;
  lastModified: number;
  /** When this copy was last compared with R2 and the tag cache. */
  checkedAt: number;
}

/** A cached page as one location hands it to another. */
export interface CurrentEntry {
  value: unknown;
  lastModified: number;
}

type Entry<Type extends CacheEntryType> = WithLastModified<CacheValue<Type>>;

// OpenNext's settings, where there is a `process` (the edge Worker runs
// without Node compatibility and passes them in).
const setting = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name];

// The R2 prefix is part of the address, so a second deployment that keeps its
// entries elsewhere in the bucket (a test Worker) never shares copies.
const copyUrl = (
  key: string,
  cacheType: CacheEntryType = "cache",
  prefix = setting("NEXT_INC_CACHE_R2_PREFIX"),
  build = setting("OPEN_NEXT_BUILD_ID"),
) =>
  "http://page-cache.local" +
  `/${prefix ?? "incremental-cache"}` +
  `/${build ?? "no-build-id"}/${encodeURIComponent(key)}.${cacheType}`;

let opened: Promise<Cache> | undefined;
const copies = () => (opened ??= caches.open(CACHE_NAME));

// What a request spent on the page cache, for the entry Worker's
// Server-Timing header (cloudflare/worker.ts): the round trips this file
// exists to avoid, when they do happen. Kept on globalThis because the entry
// and OpenNext's routing layer are bundled separately and each has its own
// copy of this module.
type Marks = WeakMap<object, string[]>;
const marks = ((
  globalThis as { __gitdiagramCacheMarks?: Marks }
).__gitdiagramCacheMarks ??= new WeakMap());

async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  let request: object | undefined;
  try {
    request = requestContext().ctx;
  } catch {
    request = undefined;
  }
  const startedAt = Date.now();
  try {
    return await work();
  } finally {
    if (request) {
      const held = marks.get(request) ?? [];
      if (held.length < 8) held.push(`${name};dur=${Date.now() - startedAt}`);
      marks.set(request, held);
    }
  }
}

/** The Server-Timing entries a request's cache work left, if any. */
export function cacheTimings(request: object): string[] {
  return marks.get(request) ?? [];
}

/** Adds a Server-Timing entry to a request (the entry Worker's own hops). */
export function markTiming(request: object, name: string, ms: number): void {
  const held = marks.get(request) ?? [];
  if (held.length < 8) held.push(`${name};dur=${ms}`);
  marks.set(request, held);
}

// The page each request found no copy of in this location (routing Worker
// only). On globalThis for the same reason as the marks.
type Wanted = WeakMap<object, string>;
const wanted = ((
  globalThis as { __gitdiagramEntryWanted?: Wanted }
).__gitdiagramEntryWanted ??= new WeakMap());

/**
 * The key of the page this request's location has no copy of, once: the
 * entry Worker sends it to the server as ENTRY_WANTED.
 */
export function takeWantedEntry(request: object): string | undefined {
  const key = wanted.get(request);
  wanted.delete(request);
  return key;
}

const later = (work: Promise<unknown>) =>
  requestContext().ctx.waitUntil(work.catch(() => undefined));

/**
 * The tags a cached page or route answer carries. Read before the entry is
 * handed to OpenNext, which strips the header from it.
 */
function pageTags(value: unknown): string[] {
  const headers = (value as { meta?: { headers?: Record<string, unknown> } })
    ?.meta?.headers;
  const raw = headers?.["x-next-cache-tags"];
  return typeof raw === "string" && raw ? raw.split(",") : [];
}

interface TagJudge {
  hasBeenRevalidated(tags: string[], lastModified?: number): Promise<boolean>;
  isStale?(tags: string[], lastModified?: number): Promise<boolean>;
}

/** Whether the tag cache still calls an entry written at `lastModified` current. */
async function isCurrent(tags: string[], lastModified: number) {
  if (!tags.length) return true;
  const judge = (globalThis as unknown as { tagCache?: TagJudge }).tagCache;
  if (!judge) return false;
  const [revalidated, stale] = await Promise.all([
    judge.hasBeenRevalidated(tags, lastModified),
    judge.isStale?.(tags, lastModified) ?? false,
  ]);
  return !revalidated && !stale;
}

const VARY_HEADER =
  "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url";
// On a page's finished response in the Cache API: what `answerFromCopy`
// needs to know about the entry it was made from.
const READY_LAST_MODIFIED = "x-copy-last-modified";
const READY_CHECKED_AT = "x-copy-checked-at";
const READY_REVALIDATE = "x-copy-revalidate";

interface AppPageValue {
  type?: unknown;
  html?: unknown;
  revalidate?: unknown;
  meta?: { status?: unknown; headers?: Record<string, unknown> };
}

/**
 * What a location keeps of an entry: the entry itself, for OpenNext's
 * routing layer, and for a plain page its HTML as a finished response, which
 * the edge Worker sends without parsing anything (`answerFromCopy`). Made
 * before the entry is handed to OpenNext, which mutates it.
 */
interface Prepared {
  body: string;
  page: {
    html: string;
    headers: Record<string, string>;
    revalidate: string;
    lastModified: number;
  } | null;
}

function prepare(value: unknown, lastModified: number): Prepared {
  const body = JSON.stringify({
    value,
    lastModified,
    checkedAt: Date.now(),
  } as Copy);
  const entry = value as AppPageValue;
  const status = entry?.meta?.status;
  const revalidate = entry?.revalidate;
  // The pages `answerFromCopy` answers: an app page that rendered with 200
  // and says how long it lives.
  if (
    entry?.type !== "app" ||
    typeof entry.html !== "string" ||
    (status !== undefined && status !== 200) ||
    !(
      revalidate === false ||
      (typeof revalidate === "number" && revalidate > 0)
    )
  )
    return { body, page: null };
  const headers: Record<string, string> = {};
  for (const [name, held] of Object.entries(entry.meta?.headers ?? {}))
    if (name !== "x-next-cache-tags" && typeof held === "string")
      headers[name] = held;
  return {
    body,
    page: {
      html: entry.html,
      headers,
      revalidate: String(revalidate),
      lastModified,
    },
  };
}

async function md5(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Where a location's copies live: the build and the R2 prefix they are of. */
interface Where {
  prefix?: string;
  build?: string;
}

const readyUrl = (key: string, where: Where = {}) =>
  `${copyUrl(key, "cache", where.prefix, where.build)}.html`;

async function writeCopy(
  key: string,
  cacheType: CacheEntryType | undefined,
  prepared: Prepared,
  where: Where = {},
) {
  const cache = await copies();
  const keep = { "cache-control": `max-age=${KEEP_SECONDS}` };
  const writes: Promise<unknown>[] = [
    cache.put(
      copyUrl(key, cacheType, where.prefix, where.build),
      new Response(prepared.body, {
        headers: { "content-type": "application/json", ...keep },
      }),
    ),
  ];
  if ((cacheType ?? "cache") === "cache") {
    const { page } = prepared;
    writes.push(
      page
        ? cache.put(
            readyUrl(key, where),
            // The response OpenNext's cache interceptor builds for the page,
            // less the lifetime it computes at each request.
            new Response(page.html, {
              headers: {
                "x-opennext-cache": "HIT",
                etag: `"${await md5(page.html)}"`,
                "content-type": "text/html; charset=utf-8",
                ...page.headers,
                vary: VARY_HEADER,
                [READY_LAST_MODIFIED]: String(page.lastModified),
                [READY_CHECKED_AT]: String(Date.now()),
                [READY_REVALIDATE]: page.revalidate,
                ...keep,
              },
            }),
          )
        : cache.delete(readyUrl(key, where)),
    );
  }
  await Promise.all(writes);
}

/** Removes this location's copy of a page (both forms of it). */
async function dropCopy(key: string, where: Where = {}) {
  const cache = await copies();
  await Promise.all([
    cache.delete(copyUrl(key, "cache", where.prefix, where.build)),
    cache.delete(readyUrl(key, where)),
  ]);
}

/**
 * The largest entry a location keeps a copy of, in characters of its main
 * text. A copy is one more serialized string of the entry in the isolate's
 * memory (two bytes a character), next to the one R2 is given, and an
 * isolate that passes 128 MB is killed with every request it is running. The
 * 8 MB sitemap is the entry this is for; pages are 60 to 400 KB.
 */
const MAX_COPY_CHARS = 1_500_000;

function isTooBigToCopy(value: unknown): boolean {
  const entry = value as { html?: unknown; body?: unknown; rsc?: unknown };
  return [entry?.html, entry?.body, entry?.rsc].some(
    (part) => typeof part === "string" && part.length > MAX_COPY_CHARS,
  );
}

/** Removes this location's copies of the given page keys. */
async function dropCopies(keys: string[]) {
  try {
    await Promise.all(keys.map((key) => dropCopy(key)));
  } catch {
    // Rechecks catch up.
  }
}

/**
 * Tells the server Worker next to the data to drop its copies too. A page is
 * revalidated wherever the request that changed it ran (a diagram run ends
 * where its visitor is), but a location without a copy is answered from the
 * copies there: left alone, they would hand the old page out for up to
 * RECHECK_MS more.
 */
async function dropCopiesAtTheServer(keys: string[]) {
  try {
    const { env } = requestContext();
    if (!env.PLACED_SERVER || !env.CRON_SECRET) return;
    const response = await env.PLACED_SERVER.fetch(
      new Request(
        new URL(CACHE_ENTRY_PATH, env.SITE_ORIGIN ?? "https://gitdiagram.com"),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.CRON_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ drop: keys }),
        },
      ),
    );
    await response.body?.cancel();
  } catch {
    // Rechecks catch up.
  }
}

// The Worker every request reaches (cloudflare/worker.ts sets the flag) only
// routes and answers cached pages: it reads entries from the server Worker,
// never from R2, and never writes one.
const routesOnly = () =>
  (globalThis as { __GITDIAGRAM_ROUTING_WORKER__?: boolean })
    .__GITDIAGRAM_ROUTING_WORKER__ === true;

// OpenNext looks for a cached page whenever a path has the shape of a
// prerendered route, and `/api/video` or `/phx9a/e` have the shape of
// `/[username]/[repo]`. In the routing Worker that lookup would be a round
// trip for nothing on every API call and analytics event: the site's own
// first segments are never cached pages there.
// Sitemaps are cached pages, but megabytes each and asked for by crawlers
// only: copying one into every location would cost the server's isolate tens
// of megabytes at a time (see MAX_COPY_CHARS). The server answers them.
const NEVER_PAGES = /^\/(?:api|phx9a|out|mcp|sitemap|__gitdiagram)(?:\/|$)/;

/** The entry in a server Worker's answer (see `entryResponse`). */
async function readEntry(response: Response): Promise<CurrentEntry | null> {
  // The server gzips the entry itself (see ENTRY_ENCODING).
  const body =
    response.headers.get(ENTRY_ENCODING) === "gzip" && response.body
      ? response.body.pipeThrough(new DecompressionStream("gzip"))
      : response.body;
  const entry = (await new Response(body).json()) as CurrentEntry;
  return entry?.value && typeof entry.lastModified === "number" ? entry : null;
}

// The entry the server just answered a request with, by request: the routing
// layer runs again for that request and must find the entry whether or not
// the Cache API already shows the copy written from it. On globalThis for the
// same reason as the marks.
type Handed = WeakMap<object, { key: string; entry: CurrentEntry }>;
const handed = ((
  globalThis as { __gitdiagramEntryHanded?: Handed }
).__gitdiagramEntryHanded ??= new WeakMap());

/**
 * Takes the entry the server answered an ENTRY_WANTED request with: it
 * becomes this location's copy (written after the response) and the answer
 * to this request's next look in the cache. False when it could not be read.
 */
export async function keepEntryFromServer(
  request: { waitUntil(promise: Promise<unknown>): void },
  key: string,
  response: Response,
): Promise<boolean> {
  try {
    const entry = await readEntry(response);
    if (!entry) return false;
    // Serialized now: OpenNext mutates the entry it is given.
    const prepared = prepare(entry.value, entry.lastModified);
    request.waitUntil(writeCopy(key, "cache", prepared).catch(() => undefined));
    handed.set(request, { key, entry });
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks the server Worker for a page's entry, to recheck this location's
 * copy. Null: there is none, or it is no longer current. Undefined: the
 * server could not be asked.
 */
async function readFromServer(
  key: string,
  fresh: boolean,
  bindings?: ReturnType<RequestContext>["env"],
): Promise<CurrentEntry | null | undefined> {
  try {
    const env = bindings ?? requestContext().env;
    if (!env.SERVER || !env.CRON_SECRET) return undefined;
    const url = new URL(
      CACHE_ENTRY_PATH,
      env.SITE_ORIGIN ?? "https://gitdiagram.com",
    );
    url.searchParams.set("key", key);
    if (fresh) url.searchParams.set("fresh", "1");
    const headers = new Headers({
      authorization: `Bearer ${env.CRON_SECRET}`,
    });
    if (env.SERVER_VERSION_OVERRIDE)
      headers.set(
        "Cloudflare-Workers-Version-Overrides",
        env.SERVER_VERSION_OVERRIDE,
      );
    const response = await env.SERVER.fetch(new Request(url, { headers }));
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return undefined;
    }
    return await readEntry(response);
  } catch {
    return undefined;
  }
}

// Pages a request already looked for in the store and did not find: the
// server looks once for the visitor's location (`entryForLocation`) and the
// render that follows would look again.
const absent = new WeakMap<object, Set<string>>();

// Rechecks under way in this isolate, so a burst of hits starts one.
const rechecking = new Set<string>();

class ColoCache implements IncrementalCache {
  name: string;
  constructor(private store: IncrementalCache) {
    this.name = store.name;
  }

  async get<Type extends CacheEntryType = "cache">(
    key: string,
    cacheType?: Type,
  ): Promise<Entry<Type> | null> {
    const isPage = (cacheType ?? "cache") === "cache";
    const routing = routesOnly();
    if (routing && (!isPage || NEVER_PAGES.test(key))) return null;
    const url = copyUrl(key, cacheType);
    try {
      const cache = await copies();
      const held = await cache.match(url);
      if (held) {
        const copy = (await held.json()) as Copy;
        if (Date.now() - copy.checkedAt > RECHECK_MS && !rechecking.has(url)) {
          rechecking.add(url);
          later(
            this.recheck(key, cacheType, pageTags(copy.value)).finally(() =>
              rechecking.delete(url),
            ),
          );
        }
        return {
          value: copy.value,
          lastModified: copy.lastModified,
          // A page's copy was current when it was written and is rechecked
          // on the schedule above. Data-cache entries are only read during a
          // render, with tags the caller knows and this wrapper does not, so
          // they stay the tag cache's call.
          shouldBypassTagCache: isPage,
        } as Entry<Type>;
      }
    } catch {
      // The Cache API is an optimisation: fall through.
    }

    if (routing) {
      const request = requestContext().ctx;
      const given = handed.get(request);
      if (given?.key === key) {
        handed.delete(request);
        // The server only hands out entries the tag cache calls current.
        return {
          value: given.entry.value,
          lastModified: given.entry.lastModified,
          shouldBypassTagCache: true,
        } as Entry<Type>;
      }
      // No copy here. The request goes on to the server marked with this
      // key: it answers with the entry if it has a current one, and the
      // entry Worker keeps that and comes back here (cloudflare/worker.ts).
      wanted.set(request, key);
      return null;
    }

    if (isPage && absent.get(requestContext().ctx)?.has(key)) return null;
    const entry = await timed("r2", () => this.store.get(key, cacheType));
    if (!entry?.value || typeof entry.lastModified !== "number") return null;
    // Serialized now: OpenNext mutates the entry it is given.
    if (isTooBigToCopy(entry.value)) return entry;
    const tags = pageTags(entry.value);
    const prepared = prepare(entry.value, entry.lastModified);
    const lastModified = entry.lastModified;
    later(
      (async () => {
        if (!isPage || (await isCurrent(tags, lastModified)))
          await writeCopy(key, cacheType, prepared);
      })(),
    );
    return entry;
  }

  /**
   * Brings this location's copy in line with the store and the tag cache,
   * and returns the entry if it is current.
   */
  private async recheck(
    key: string,
    cacheType: CacheEntryType | undefined,
    heldTags: string[],
  ): Promise<CurrentEntry | null> {
    const drop = async () => {
      if ((cacheType ?? "cache") === "cache") await dropCopy(key);
      else await (await copies()).delete(copyUrl(key, cacheType));
      return null;
    };
    if (routesOnly()) {
      const entry = await readFromServer(key, true);
      // The server could not be asked: the copy stays as it is.
      if (entry === undefined) return null;
      if (!entry) return drop();
      await writeCopy(key, cacheType, prepare(entry.value, entry.lastModified));
      return entry;
    }
    const entry = await this.store.get(key, cacheType);
    if (!entry?.value || typeof entry.lastModified !== "number") {
      const request = requestContext().ctx;
      absent.set(request, (absent.get(request) ?? new Set()).add(key));
      return drop();
    }
    const tags = pageTags(entry.value);
    const current =
      (cacheType ?? "cache") !== "cache" ||
      (await isCurrent(tags.length ? tags : heldTags, entry.lastModified));
    // Revalidated: the next request reads R2 and takes the tag cache's
    // verdict (a fresh render, or the old page while one is made).
    if (!current) return drop();
    if (!isTooBigToCopy(entry.value))
      await writeCopy(key, cacheType, prepare(entry.value, entry.lastModified));
    return { value: entry.value, lastModified: entry.lastModified };
  }

  /**
   * A page's entry for another location (the routing Worker asks through
   * CACHE_ENTRY_PATH), or null when there is none or the tag cache no longer
   * calls it current. It comes from this location's copy while that is
   * trusted, else from R2 and the tag cache (which also brings the copy here
   * in line). `fresh`: the asking location is rechecking its own copy.
   */
  async entryForLocation(
    key: string,
    fresh: boolean,
  ): Promise<CurrentEntry | null> {
    let copy: Copy | undefined;
    try {
      const held = await (await copies()).match(copyUrl(key, "cache"));
      copy = held ? ((await held.json()) as Copy) : undefined;
    } catch {
      copy = undefined;
    }
    // A location rechecking its own copy still takes one checked here in
    // the last few seconds: many locations recheck a popular page at once.
    const trustedFor = fresh ? FRESH_WITHIN_MS : RECHECK_MS;
    if (copy && Date.now() - copy.checkedAt <= trustedFor)
      return { value: copy.value, lastModified: copy.lastModified };
    return this.recheck(key, "cache", copy ? pageTags(copy.value) : []);
  }

  async set<Type extends CacheEntryType = "cache">(
    key: string,
    value: CacheValue<Type>,
    cacheType?: Type,
  ): Promise<void> {
    await this.store.set(key, value, cacheType);
    if (isTooBigToCopy(value)) return;
    // After the store, so the two serialized strings are never held at once.
    await writeCopy(key, cacheType, prepare(value, Date.now())).catch(
      () => undefined,
    );
  }

  async delete(key: string): Promise<void> {
    await this.store.delete(key);
    await dropCopies([key]);
  }

  /** Removes this location's copies of pages revalidated somewhere else. */
  dropCopies(keys: string[]): Promise<void> {
    return dropCopies(keys);
  }
}

/** What the server Worker's entry calls on OpenNext's incremental cache. */
export interface EntrySource {
  entryForLocation(key: string, fresh: boolean): Promise<CurrentEntry | null>;
  dropCopies(keys: string[]): Promise<void>;
}

/** R2 (or any store) with a copy of each entry in every Cloudflare location. */
export const withColoCache = (
  store: IncrementalCache,
): IncrementalCache & EntrySource => new ColoCache(store);

// "Stale?" verdicts asked for but not collected yet, per request (a promise
// one request started must never be awaited by another on Workers).
const staleVerdicts = new WeakMap<object, Map<string, Promise<boolean>>>();

/**
 * Two additions to the tag cache:
 *
 * - `revalidatePath` names a page by a tag made of its path. The page was
 *   just invalidated by someone about to look at it: the copy in this
 *   location and the one next to the data (which every location without a
 *   copy is answered from) are dropped at once rather than at their next
 *   recheck.
 * - OpenNext asks "revalidated?" and then "stale?" about the same tags, one
 *   after the other, and each is a round trip to a Durable Object when the
 *   location has no answer cached. The second question is asked alongside
 *   the first, so a page read from R2 waits for one round trip, not two.
 */
export function withColoPurge(inner: NextModeTagCache): NextModeTagCache {
  const writeTags = inner.writeTags.bind(inner);
  inner.writeTags = async (tags) => {
    await writeTags(tags);
    const keys = tags
      .map((tag) => (typeof tag === "string" ? tag : tag.tag))
      .filter((tag) => tag.startsWith(`${SOFT_TAG_PREFIX}/`))
      .map((tag) => tag.slice(SOFT_TAG_PREFIX.length))
      .flatMap((path) => (path === "/" ? ["/index"] : [path]));
    if (keys.length)
      await Promise.all([dropCopies(keys), dropCopiesAtTheServer(keys)]);
  };

  const hasBeenRevalidated = inner.hasBeenRevalidated.bind(inner);
  const isStale = inner.isStale?.bind(inner);
  if (isStale) {
    const verdictKey = (tags: string[], lastModified?: number) =>
      `${lastModified ?? ""}|${tags.join(",")}`;
    const verdicts = () => {
      const request = requestContext().ctx;
      let held = staleVerdicts.get(request);
      if (!held) staleVerdicts.set(request, (held = new Map()));
      return held;
    };
    inner.hasBeenRevalidated = (tags, lastModified) => {
      if (tags.length && lastModified !== undefined) {
        const verdict = isStale(tags, lastModified);
        verdict.catch(() => undefined);
        verdicts().set(verdictKey(tags, lastModified), verdict);
      }
      return timed("tags", () => hasBeenRevalidated(tags, lastModified));
    };
    inner.isStale = (tags, lastModified) => {
      const held = verdicts();
      const key = verdictKey(tags, lastModified);
      const verdict = held.get(key);
      if (!verdict) return isStale(tags, lastModified);
      held.delete(key);
      return verdict;
    };
  }
  return inner;
}

// Revalidations this isolate already asked for (by deduplication id).
const queued = new Map<string, number>();
const QUEUED_FOR_MS = 60_000;

/**
 * A page past its lifetime is answered at once and re-rendered through the
 * queue (a Durable Object). Asking it is a round trip the visitor should not
 * wait for, and until the new render reaches this location every hit would
 * ask again: send after the response, once a minute per page and isolate.
 */
export function withBackgroundSend(inner: Queue): Queue {
  return {
    name: inner.name,
    send: async (message) => {
      const id = message.MessageDeduplicationId;
      const now = Date.now();
      if ((queued.get(id) ?? 0) > now - QUEUED_FOR_MS) return;
      if (queued.size > 500) queued.clear();
      queued.set(id, now);
      later(inner.send(message));
    },
  };
}

// ---------------------------------------------------------------------------
// The short way to a cached page. Most requests the site gets are for the
// HTML of a page this location already holds, and OpenNext's routing layer is
// a long way round to it: it is 0.3 MB of script with its Durable Objects and
// containers, and a new isolate of a Worker that size takes about 70 ms
// longer to answer than a warm one (a third of the hits on a cached page are
// a new isolate's first request). `answerFromCopy` is the edge Worker's own
// answer for the plain case (cloudflare/edge.ts, 30 KB, which starts as fast
// as it runs), built exactly as OpenNext's cache interceptor builds it;
// anything else is left to the routing layer.

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const ONE_MONTH_SECONDS = 60 * 60 * 24 * 30;
/** A request with this header is always answered by the routing layer. */
export const FULL_PATH_HEADER = "x-gitdiagram-full-path";

/**
 * The cache key of the page a request asks for when it is the plain case (a
 * GET for a page's HTML at a path with nothing to decode), else null:
 * anything else is the routing layer's to answer.
 */
export function plainPageKey(request: Request, url: URL): string | null {
  if (request.method !== "GET") return null;
  const headers = request.headers;
  if (
    headers.has("rsc") ||
    headers.has("next-action") ||
    headers.has("x-prerender-revalidate") ||
    headers.has(FULL_PATH_HEADER)
  )
    return null;
  const cookie = headers.get("cookie") ?? "";
  if (
    cookie.includes("__prerender_bypass") ||
    cookie.includes("__next_preview_data")
  )
    return null;
  // The key is then the path as OpenNext would compute it.
  if (
    !/^\/[A-Za-z0-9_.~/-]*$/.test(url.pathname) ||
    url.pathname.includes("//")
  )
    return null;
  const path = url.pathname.replace(/\/$/, "");
  const key = path === "" ? "/index" : path;
  return NEVER_PAGES.test(key) ? null : key;
}

type EdgeEnv = ReturnType<RequestContext>["env"] & {
  NEXT_INC_CACHE_R2_PREFIX?: string;
};

/**
 * How long a page may still be served, in seconds, or null when it is past
 * its lifetime (the routing layer then answers and queues its re-render).
 */
function remainingLifetime(
  revalidate: string | null,
  lastModified: number,
): number | null {
  if (revalidate === "false") return ONE_YEAR_SECONDS;
  const age = Math.round((Date.now() - lastModified) / 1000);
  const remaining = Math.max(Number(revalidate) - age, 1);
  return remaining > 1 ? remaining : null;
}

/** A stale page's re-render is asked for this often at most, per isolate. */
const RESTART_HOLD_MS = 10_000;
/** When, after asking, the server is asked for the new render. */
const RESTART_LOOKS_MS = [1_500, 2_500, 4_000, 8_000];
const restarted = new Map<string, number>();

/**
 * The page a GET asks for, from this location's copy, or null when the
 * routing layer must answer: no copy, not a plain HTML page request, an error
 * page, or anything unusual about the request.
 *
 * A page past its lifetime is answered stale, as OpenNext's cache interceptor
 * answers it, when the caller gives `restart`: the routing layer's own pass
 * over the request, which queues the re-render. It runs after the response
 * (at most once per RESTART_HOLD_MS per isolate), and the copy is replaced
 * as soon as the server holds the new render. Without `restart`: null.
 */
export async function answerFromCopy(
  request: Request,
  url: URL,
  env: EdgeEnv,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  /** The build whose pages these are (the cache's addresses carry it). */
  build: string,
  restart?: () => Promise<unknown>,
): Promise<Response | null> {
  const key = plainPageKey(request, url);
  if (!key) return null;
  const where = {
    prefix: env.NEXT_INC_CACHE_R2_PREFIX ?? "incremental-cache",
    build,
  };
  const address = readyUrl(key, where);
  let held: Response | undefined;
  try {
    held = await (await copies()).match(address);
  } catch {
    held = undefined;
  }
  if (!held) return null;
  const answer = new Headers(held.headers);
  const lastModified = Number(answer.get(READY_LAST_MODIFIED));
  const checkedAt = Number(answer.get(READY_CHECKED_AT));
  const revalidate = answer.get(READY_REVALIDATE);
  const sMaxAge = remainingLifetime(revalidate, lastModified);
  if (sMaxAge === null) {
    if (!restart) {
      void held.body?.cancel();
      return null;
    }
    if (!(Date.now() - (restarted.get(address) ?? 0) <= RESTART_HOLD_MS)) {
      restarted.set(address, Date.now());
      if (restarted.size > 500) restarted.clear();
      ctx.waitUntil(
        (async () => {
          await restart();
          // The re-render is queued: the copy follows it.
          for (const wait of RESTART_LOOKS_MS) {
            await new Promise((resolve) => setTimeout(resolve, wait));
            const entry = await readFromServer(key, true, env);
            if (entry === undefined) return;
            if (!entry) return dropCopy(key, where);
            if (entry.lastModified <= lastModified) continue;
            return writeCopy(
              key,
              "cache",
              prepare(entry.value, entry.lastModified),
              where,
            );
          }
        })().catch(() => undefined),
      );
    }
  } else if (
    !(Date.now() - checkedAt <= RECHECK_MS) &&
    !rechecking.has(address)
  ) {
    rechecking.add(address);
    ctx.waitUntil(
      (async () => {
        const entry = await readFromServer(key, true, env);
        // The server could not be asked: the copy stays as it is.
        if (entry === undefined) return;
        if (!entry) await dropCopy(key, where);
        else
          await writeCopy(
            key,
            "cache",
            prepare(entry.value, entry.lastModified),
            where,
          );
      })()
        .catch(() => undefined)
        .finally(() => rechecking.delete(address)),
    );
  }

  // Its own notes, and what the Cache API adds to a response it kept.
  for (const name of [
    READY_LAST_MODIFIED,
    READY_CHECKED_AT,
    READY_REVALIDATE,
    "accept-ranges",
    "age",
    "cf-cache-status",
    "expires",
    "last-modified",
  ])
    answer.delete(name);
  answer.set(
    "cache-control",
    `s-maxage=${sMaxAge ?? 1}, stale-while-revalidate=${ONE_MONTH_SECONDS}`,
  );
  if (sMaxAge === null) answer.set("x-opennext-cache", "STALE");
  // The body goes out as it comes from the cache: nothing is parsed.
  return new Response(held.body, { status: 200, headers: answer });
}

/**
 * The page a GET asks for, from the entry the server Worker answered an
 * ENTRY_WANTED request with: the entry becomes this location's copy (after
 * the response) and, when it is a plain page still within its lifetime, the
 * answer. Null when the routing layer must answer after all.
 */
export async function answerFromEntry(
  key: string,
  response: Response,
  env: EdgeEnv,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  build: string,
): Promise<Response | null> {
  let entry: CurrentEntry | null;
  try {
    entry = await readEntry(response);
  } catch {
    entry = null;
  }
  if (!entry) return null;
  const prepared = prepare(entry.value, entry.lastModified);
  ctx.waitUntil(
    writeCopy(key, "cache", prepared, {
      prefix: env.NEXT_INC_CACHE_R2_PREFIX ?? "incremental-cache",
      build,
    }).catch(() => undefined),
  );
  const { page } = prepared;
  if (!page) return null;
  const sMaxAge = remainingLifetime(page.revalidate, page.lastModified);
  if (sMaxAge === null) return null;
  return new Response(page.html, {
    status: 200,
    headers: {
      "cache-control": `s-maxage=${sMaxAge}, stale-while-revalidate=${ONE_MONTH_SECONDS}`,
      "x-opennext-cache": "HIT",
      etag: `"${await md5(page.html)}"`,
      "content-type": "text/html; charset=utf-8",
      ...page.headers,
      vary: VARY_HEADER,
    },
  });
}
