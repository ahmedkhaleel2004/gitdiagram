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
// 2. A location without a copy asks the server Worker for the entry
//    (`CACHE_ENTRY_PATH`, over the service binding): one round trip to where
//    the server runs, next to R2 and the tag cache, instead of two long ones
//    from the visitor's side of the world. The server answers from its own
//    location's copies, which hold every page the world has asked for.
// 3. The server reads R2 and asks the tag cache.
//
// Freshness: `revalidatePath` drops the copy where the server runs at once,
// so the next request for the page renders it (not the old page first); a
// copy elsewhere follows within RECHECK_MS plus one request. A copy is only
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

/** Where the server Worker hands out cache entries (cloudflare/server.ts). */
export const CACHE_ENTRY_PATH = "/__gitdiagram/cache-entry";
/**
 * An entry is 60 to 400 KB of JSON and crosses an ocean on its way to the
 * asking location, on a connection that is often new: every doubling of the
 * congestion window is another round trip. The server gzips it (to about a
 * fifth) and says so in this header rather than `Content-Encoding`, which
 * the runtime would act on by itself.
 */
const ENTRY_ENCODING = "x-gitdiagram-entry-encoding";

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

const buildId = () => process.env.OPEN_NEXT_BUILD_ID ?? "no-build-id";

// The R2 prefix is part of the address, so a second deployment that keeps its
// entries elsewhere in the bucket (a test Worker) never shares copies.
const copyUrl = (key: string, cacheType: CacheEntryType = "cache") =>
  "http://page-cache.local" +
  `/${process.env.NEXT_INC_CACHE_R2_PREFIX ?? "incremental-cache"}` +
  `/${buildId()}/${encodeURIComponent(key)}.${cacheType}`;

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

async function writeCopy(
  key: string,
  cacheType: CacheEntryType | undefined,
  body: string,
) {
  const cache = await copies();
  await cache.put(
    copyUrl(key, cacheType),
    new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": `max-age=${KEEP_SECONDS}`,
      },
    }),
  );
}

const copyBody = (value: unknown, lastModified: number) =>
  JSON.stringify({ value, lastModified, checkedAt: Date.now() } as Copy);

/** Removes this location's copies of the given page keys. */
async function dropCopies(keys: string[]) {
  try {
    const cache = await copies();
    await Promise.all(keys.map((key) => cache.delete(copyUrl(key, "cache"))));
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
const NEVER_PAGES = /^\/(?:api|phx9a|out|mcp|__gitdiagram)(?:\/|$)/;

/**
 * Asks the server Worker for a page's entry. Null: there is none, or it is
 * not current (the request then goes to the server, which decides between a
 * fresh render and the old page). Undefined: the server could not be asked.
 */
async function readFromServer(
  key: string,
  fresh: boolean,
): Promise<CurrentEntry | null | undefined> {
  try {
    const { env } = requestContext();
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
    // The server gzips the entry itself (see ENTRY_ENCODING).
    const body =
      response.headers.get(ENTRY_ENCODING) === "gzip" && response.body
        ? response.body.pipeThrough(new DecompressionStream("gzip"))
        : response.body;
    const entry = (await new Response(body).json()) as CurrentEntry;
    return entry?.value && typeof entry.lastModified === "number"
      ? entry
      : null;
  } catch {
    return undefined;
  }
}

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
      const entry = await timed("origin", () => readFromServer(key, false));
      if (!entry) return null;
      // Serialized now: OpenNext mutates the entry it is given.
      later(
        writeCopy(key, cacheType, copyBody(entry.value, entry.lastModified)),
      );
      // The server only hands out entries the tag cache calls current.
      return {
        value: entry.value,
        lastModified: entry.lastModified,
        shouldBypassTagCache: true,
      } as Entry<Type>;
    }

    const entry = await timed("r2", () => this.store.get(key, cacheType));
    if (!entry?.value || typeof entry.lastModified !== "number") return null;
    // Serialized now: OpenNext mutates the entry it is given.
    const tags = pageTags(entry.value);
    const body = copyBody(entry.value, entry.lastModified);
    const lastModified = entry.lastModified;
    later(
      (async () => {
        if (!isPage || (await isCurrent(tags, lastModified)))
          await writeCopy(key, cacheType, body);
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
      await (await copies()).delete(copyUrl(key, cacheType));
      return null;
    };
    if (routesOnly()) {
      const entry = await readFromServer(key, true);
      // The server could not be asked: the copy stays as it is.
      if (entry === undefined) return null;
      if (!entry) return drop();
      await writeCopy(
        key,
        cacheType,
        copyBody(entry.value, entry.lastModified),
      );
      return entry;
    }
    const entry = await this.store.get(key, cacheType);
    if (!entry?.value || typeof entry.lastModified !== "number") return drop();
    const tags = pageTags(entry.value);
    const current =
      (cacheType ?? "cache") !== "cache" ||
      (await isCurrent(tags.length ? tags : heldTags, entry.lastModified));
    // Revalidated: the next request reads R2 and takes the tag cache's
    // verdict (a fresh render, or the old page while one is made).
    if (!current) return drop();
    await writeCopy(key, cacheType, copyBody(entry.value, entry.lastModified));
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
    // The copy is serialized first: `store.set` may hand the value on.
    const body = copyBody(value, Date.now());
    await this.store.set(key, value, cacheType);
    await writeCopy(key, cacheType, body).catch(() => undefined);
  }

  async delete(key: string): Promise<void> {
    await this.store.delete(key);
    await dropCopies([key]);
  }
}

/** What the server Worker's entry calls on OpenNext's incremental cache. */
export interface EntrySource {
  entryForLocation(key: string, fresh: boolean): Promise<CurrentEntry | null>;
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
 *   just invalidated here, where the server runs and every location without
 *   a copy asks: this location's copy is dropped at once rather than at its
 *   next recheck.
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
    if (keys.length) await dropCopies(keys);
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
