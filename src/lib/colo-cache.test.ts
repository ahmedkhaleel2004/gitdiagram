// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IncrementalCache,
  NextModeTagCache,
  Queue,
} from "@opennextjs/aws/types/overrides.js";

import {
  CACHE_ENTRY_PATH,
  FULL_PATH_HEADER,
  answerFromCopy,
  answerFromEntry,
  entryResponse,
  keepEntryFromServer,
  plainPageKey,
  type RequestContext,
  setRequestContext,
  takeWantedEntry,
  withBackgroundSend,
  withColoCache,
  withColoPurge,
} from "./colo-cache";

// A Cache API location: copies by address (bodies, and their headers).
const held = new Map<string, string>();
const heldHeaders = new Map<string, [string, string][]>();
const fakeCache = {
  match: async (key: string) =>
    held.has(key)
      ? new Response(held.get(key), { headers: heldHeaders.get(key) })
      : undefined,
  put: async (key: string, response: Response) => {
    heldHeaders.set(key, [...response.headers]);
    held.set(key, await response.text());
  },
  delete: async (key: string) => held.delete(key),
};

let background: Promise<unknown>[] = [];
const settle = async () => {
  while (background.length) {
    const work = background;
    background = [];
    await Promise.all(work);
  }
};

const page = (html: string, tags = "_N_T_/acme/demo,diagram:acme/demo") => ({
  type: "app" as const,
  html,
  meta: { headers: { "x-next-cache-tags": tags } },
});

function fakeStore(
  entries: Record<string, { value: unknown; lastModified: number }>,
) {
  const store = {
    name: "fake",
    get: vi.fn(async (key: string) => {
      const entry = entries[key];
      // A fresh object each time, as R2 gives.
      return entry ? structuredClone(entry) : null;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      entries[key] = {
        value: structuredClone(value),
        lastModified: Date.now(),
      };
    }),
    delete: vi.fn(async (key: string) => {
      delete entries[key];
    }),
  };
  return store as unknown as IncrementalCache & typeof store;
}

const judge = {
  revalidated: false,
  stale: false,
  hasBeenRevalidated: vi.fn(async () => judge.revalidated),
  isStale: vi.fn(async () => judge.stale),
};

const globals = globalThis as Record<string, unknown>;

let request: ReturnType<RequestContext>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  held.clear();
  background = [];
  judge.revalidated = false;
  judge.stale = false;
  judge.hasBeenRevalidated.mockClear();
  judge.isStale.mockClear();
  vi.stubGlobal("caches", { open: async () => fakeCache });
  // Workers' Web Crypto has MD5 (the ETag OpenNext computes); Node's does not.
  vi.spyOn(crypto.subtle, "digest").mockImplementation(
    async (_algorithm, data) =>
      new Uint8Array(
        createHash("md5")
          .update(new Uint8Array(data as ArrayBuffer))
          .digest(),
      ).buffer,
  );
  globals.tagCache = judge;
  delete globals.__GITDIAGRAM_ROUTING_WORKER__;
  // One request for the whole test (the same objects every time, as the
  // Worker runtime gives).
  request = {
    ctx: { waitUntil: (work: Promise<unknown>) => void background.push(work) },
    env: {},
  };
  setRequestContext(() => request);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("withColoCache", () => {
  it("reads R2 once, then answers from the location's copy alone", async () => {
    const store = fakeStore({
      "/acme/demo": { value: page("one"), lastModified: 1000 },
    });
    const cache = withColoCache(store);

    const first = await cache.get("/acme/demo");
    expect(first?.shouldBypassTagCache).toBeUndefined();
    expect(first?.lastModified).toBe(1000);
    await settle();
    expect(held.size).toBe(1);

    const second = await cache.get("/acme/demo");
    expect((second?.value as { html: string }).html).toBe("one");
    expect(second?.lastModified).toBe(1000);
    // The tag cache is not asked about a copy.
    expect(second?.shouldBypassTagCache).toBe(true);
    await settle();
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("keeps the tags OpenNext strips from the entry it is given", async () => {
    const store = fakeStore({
      "/acme/demo": { value: page("one"), lastModified: 1000 },
    });
    const cache = withColoCache(store);
    const entry = await cache.get("/acme/demo");
    // What OpenNext's getTagsFromValue does to the entry.
    delete (
      entry!.value as { meta: { headers: Record<string, string | undefined> } }
    ).meta.headers["x-next-cache-tags"];
    await settle();
    const copy = await cache.get("/acme/demo");
    expect(
      (copy!.value as ReturnType<typeof page>).meta.headers[
        "x-next-cache-tags"
      ],
    ).toBe("_N_T_/acme/demo,diagram:acme/demo");
  });

  it.each(["revalidated", "stale"] as const)(
    "keeps no copy of an entry the tag cache calls %s",
    async (verdict) => {
      judge[verdict] = true;
      const store = fakeStore({
        "/acme/demo": { value: page("old"), lastModified: 1000 },
      });
      const cache = withColoCache(store);
      expect(await cache.get("/acme/demo")).not.toBeNull();
      await settle();
      expect(held.size).toBe(0);
      expect(judge.hasBeenRevalidated).toHaveBeenCalledWith(
        ["_N_T_/acme/demo", "diagram:acme/demo"],
        1000,
      );
    },
  );

  it("answers from an old copy at once and replaces it after the response", async () => {
    const entries = {
      "/acme/demo": { value: page("one"), lastModified: 1000 },
    };
    const store = fakeStore(entries);
    const cache = withColoCache(store);
    await cache.get("/acme/demo");
    await settle();

    // Re-rendered somewhere else.
    entries["/acme/demo"] = { value: page("two"), lastModified: 2000 };
    vi.advanceTimersByTime(29_000);
    expect(
      ((await cache.get("/acme/demo"))!.value as { html: string }).html,
    ).toBe("one");
    await settle();
    expect(store.get).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    const stale = await cache.get("/acme/demo");
    expect((stale!.value as { html: string }).html).toBe("one");
    await settle();
    expect(store.get).toHaveBeenCalledTimes(2);
    const fresh = await cache.get("/acme/demo");
    expect((fresh!.value as { html: string }).html).toBe("two");
    expect(fresh!.lastModified).toBe(2000);
  });

  it("drops a copy whose page was revalidated elsewhere", async () => {
    const store = fakeStore({
      "/acme/demo": { value: page("one"), lastModified: 1000 },
    });
    const cache = withColoCache(store);
    await cache.get("/acme/demo");
    await settle();

    judge.revalidated = true;
    vi.advanceTimersByTime(31_000);
    await cache.get("/acme/demo");
    await settle();
    expect(held.size).toBe(0);
    // The next request takes the tag cache's verdict on the R2 entry.
    const next = await cache.get("/acme/demo");
    expect(next?.shouldBypassTagCache).toBeUndefined();
  });

  it("drops a copy whose entry left R2", async () => {
    const entries: Record<string, { value: unknown; lastModified: number }> = {
      "/acme/demo": { value: page("one"), lastModified: 1000 },
    };
    const cache = withColoCache(fakeStore(entries));
    await cache.get("/acme/demo");
    await settle();
    delete entries["/acme/demo"];
    vi.advanceTimersByTime(31_000);
    await cache.get("/acme/demo");
    await settle();
    expect(await cache.get("/acme/demo")).toBeNull();
  });

  it("puts a page rendered here into this location at once", async () => {
    const store = fakeStore({});
    const cache = withColoCache(store);
    await cache.set("/acme/demo", page("new") as never);
    const copy = await cache.get("/acme/demo");
    expect((copy!.value as { html: string }).html).toBe("new");
    expect(copy!.shouldBypassTagCache).toBe(true);
    expect(store.get).not.toHaveBeenCalled();
  });

  it("keeps no copy of an entry of megabytes", async () => {
    const sitemap = {
      type: "route" as const,
      body: "x".repeat(1_600_000),
      meta: { headers: { "x-next-cache-tags": "_N_T_/huge/page" } },
    };
    const entries: Record<string, { value: unknown; lastModified: number }> =
      {};
    const store = fakeStore(entries);
    const cache = withColoCache(store);
    await cache.set("/huge/page", sitemap as never);
    expect(held.size).toBe(0);
    expect(await cache.get("/huge/page")).not.toBeNull();
    await settle();
    expect(held.size).toBe(0);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("leaves data-cache entries to the tag cache", async () => {
    const store = fakeStore({
      abc: {
        value: { kind: "FETCH", tags: ["diagram:acme/demo"] },
        lastModified: 1000,
      },
    });
    const cache = withColoCache(store);
    await cache.get("abc", "fetch");
    await settle();
    const copy = await cache.get("abc", "fetch");
    expect(copy?.shouldBypassTagCache).toBe(false);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("hands another location a page's entry only while it is current", async () => {
    const entries = {
      "/acme/demo": { value: page("one"), lastModified: 1000 },
    };
    const store = fakeStore(entries);
    const cache = withColoCache(store);

    // From R2, judged by the tag cache.
    expect(await cache.entryForLocation("/acme/demo", false)).toEqual({
      value: page("one"),
      lastModified: 1000,
    });
    expect(judge.hasBeenRevalidated).toHaveBeenCalled();
    await settle();
    // Then from this location's copy.
    expect(await cache.entryForLocation("/acme/demo", false)).not.toBeNull();
    expect(store.get).toHaveBeenCalledTimes(1);
    expect(await cache.entryForLocation("/missing/page", false)).toBeNull();

    // A location rechecking its copy takes this one only if it was checked
    // in the last ten seconds; otherwise R2 and the tag cache are asked, and
    // the copy here is brought in line.
    entries["/acme/demo"] = { value: page("two"), lastModified: 2000 };
    vi.advanceTimersByTime(9_000);
    const recent = await cache.entryForLocation("/acme/demo", true);
    expect((recent!.value as { html: string }).html).toBe("one");
    vi.advanceTimersByTime(2_000);
    const fresh = await cache.entryForLocation("/acme/demo", true);
    expect((fresh!.value as { html: string }).html).toBe("two");
    expect(
      ((await cache.get("/acme/demo"))!.value as { html: string }).html,
    ).toBe("two");

    vi.advanceTimersByTime(11_000);
    judge.revalidated = true;
    expect(await cache.entryForLocation("/acme/demo", true)).toBeNull();
    expect(held.size).toBe(0);
    expect(await cache.entryForLocation("/acme/demo", false)).toBeNull();
  });

  it("looks in R2 once for a page that is not there", async () => {
    const store = fakeStore({});
    const cache = withColoCache(store);
    // The server looks for the visitor's location, then renders: the render
    // asks the cache again.
    expect(await cache.entryForLocation("/acme/new", false)).toBeNull();
    expect(await cache.get("/acme/new")).toBeNull();
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  describe("in the routing Worker", () => {
    const asked: Request[] = [];
    let answer: () => Response;

    beforeEach(() => {
      globals.__GITDIAGRAM_ROUTING_WORKER__ = true;
      asked.length = 0;
      answer = () => new Response(null, { status: 404 });
      request.env = {
        CRON_SECRET: "s3cret",
        SITE_ORIGIN: "https://gitdiagram.com",
        SERVER_VERSION_OVERRIDE: 'gitdiagram-server="v1"',
        SERVER: {
          fetch: async (sent: Request) => {
            asked.push(sent);
            return answer();
          },
        },
      };
    });

    it("marks a page it has no copy of as wanted from the server, and reads no store", async () => {
      const store = fakeStore({});
      const cache = withColoCache(store);
      expect(await cache.get("/acme/demo")).toBeNull();
      expect(takeWantedEntry(request.ctx)).toBe("/acme/demo");
      // Taken once.
      expect(takeWantedEntry(request.ctx)).toBeUndefined();
      expect(asked).toHaveLength(0);
      expect(store.get).not.toHaveBeenCalled();
    });

    it("keeps the entry the server answers with and then answers from it", async () => {
      const store = fakeStore({});
      const cache = withColoCache(store);
      // As the server sends it: gzipped.
      // The Cache API does not show the copy yet: the routing layer's second
      // look for this request still finds the entry.
      const put = fakeCache.put;
      let finishPut: () => void = () => undefined;
      fakeCache.put = async (key, response) => {
        await new Promise<void>((resolve) => (finishPut = resolve));
        await put(key, response);
      };
      const kept = await keepEntryFromServer(
        request.ctx,
        "/acme/demo",
        entryResponse({ value: page("one"), lastModified: 1000 }),
      );
      fakeCache.put = put;
      expect(kept).toBe(true);
      expect(held.size).toBe(0);
      const entry = await cache.get("/acme/demo");
      expect((entry!.value as { html: string }).html).toBe("one");
      expect(entry!.lastModified).toBe(1000);
      // The server only hands out current entries.
      expect(entry!.shouldBypassTagCache).toBe(true);
      expect(takeWantedEntry(request.ctx)).toBeUndefined();
      expect(judge.hasBeenRevalidated).not.toHaveBeenCalled();
      // Then the copy is written, and later requests are answered from it.
      finishPut();
      await settle();
      expect(held.size).toBe(1);
      expect(await cache.get("/acme/demo")).not.toBeNull();
      expect(takeWantedEntry(request.ctx)).toBeUndefined();

      expect(
        await keepEntryFromServer(
          request.ctx,
          "/acme/other",
          new Response("not an entry"),
        ),
      ).toBe(false);
    });

    it("rechecks an old copy against the server", async () => {
      const cache = withColoCache(fakeStore({}));
      await keepEntryFromServer(
        request.ctx,
        "/acme/demo",
        entryResponse({ value: page("one"), lastModified: 1000 }),
      );
      // The request it was handed to takes it; later ones read the copy.
      await cache.get("/acme/demo");
      await settle();

      vi.advanceTimersByTime(31_000);
      answer = () => entryResponse({ value: page("two"), lastModified: 2000 });
      expect(
        ((await cache.get("/acme/demo"))!.value as { html: string }).html,
      ).toBe("one");
      await settle();
      expect(asked).toHaveLength(1);
      const sent = new URL(asked[0]!.url);
      expect(sent.origin).toBe("https://gitdiagram.com");
      expect(sent.pathname).toBe(CACHE_ENTRY_PATH);
      expect(sent.searchParams.get("key")).toBe("/acme/demo");
      expect(sent.searchParams.get("fresh")).toBe("1");
      expect(asked[0]!.headers.get("authorization")).toBe("Bearer s3cret");
      expect(
        asked[0]!.headers.get("cloudflare-workers-version-overrides"),
      ).toBe('gitdiagram-server="v1"');
      expect(
        ((await cache.get("/acme/demo"))!.value as { html: string }).html,
      ).toBe("two");

      // The server cannot be asked: the copy stays.
      vi.advanceTimersByTime(31_000);
      answer = () => new Response(null, { status: 503 });
      await cache.get("/acme/demo");
      await settle();
      expect(held.size).toBe(1);

      // Revalidated: the copy goes, and the next request goes to the server.
      vi.advanceTimersByTime(31_000);
      answer = () => new Response(null, { status: 404 });
      await cache.get("/acme/demo");
      await settle();
      expect(held.size).toBe(0);
    });

    it("never looks for a page under the site's own paths, or for data", async () => {
      const store = fakeStore({});
      const cache = withColoCache(store);
      expect(await cache.get("/api/video")).toBeNull();
      expect(await cache.get("/phx9a/e")).toBeNull();
      expect(await cache.get("/sitemap/0.xml")).toBeNull();
      expect(await cache.get("abc", "fetch")).toBeNull();
      expect(takeWantedEntry(request.ctx)).toBeUndefined();
      await cache.get("/apiary/demo");
      expect(takeWantedEntry(request.ctx)).toBe("/apiary/demo");
      expect(asked).toHaveLength(0);
      expect(store.get).not.toHaveBeenCalled();
    });
  });

  it("falls back to R2 when the Cache API fails", async () => {
    vi.stubGlobal("caches", {
      open: async () => ({
        ...fakeCache,
        match: async () => {
          throw new Error("unavailable");
        },
      }),
    });
    const store = fakeStore({
      "/down/cache": { value: page("one"), lastModified: 1000 },
    });
    // A new module instance would reopen the cache; this one may hold the
    // working handle, so only the result matters here.
    const entry = await withColoCache(store).get("/down/cache");
    expect((entry!.value as { html: string }).html).toBe("one");
  });
});

describe("withColoPurge", () => {
  const tagCache = () => {
    // The wrapper replaces methods on the object it is given.
    const inner = {
      writeTags: vi.fn(async () => undefined),
      hasBeenRevalidated: vi.fn(async () => false),
      isStale: vi.fn(async () => true),
    };
    const wrapped = withColoPurge({
      mode: "nextMode",
      name: "fake",
      getLastRevalidated: async () => 0,
      ...inner,
    } as unknown as NextModeTagCache);
    return { inner, wrapped };
  };

  it("drops this location's copy of a revalidated path", async () => {
    const store = fakeStore({});
    const cache = withColoCache(store);
    await cache.set("/acme/demo", page("one") as never);
    await cache.set("/index", page("home", "_N_T_/") as never);
    await cache.set("/other/repo", page("other") as never);
    expect(held.size).toBe(3);

    const { inner, wrapped } = tagCache();
    await wrapped.writeTags([
      { tag: "_N_T_/acme/demo", expire: Date.now() },
      "_N_T_/",
      "diagram:other/repo",
    ]);
    expect(inner.writeTags).toHaveBeenCalledTimes(1);
    expect([...held.keys()].map((key) => decodeURIComponent(key))).toEqual([
      expect.stringContaining("/other/repo.cache"),
    ]);
  });

  it("has the server next to the data drop its copy too", async () => {
    const sent: Request[] = [];
    request.env = {
      CRON_SECRET: "s3cret",
      SITE_ORIGIN: "https://gitdiagram.com",
      PLACED_SERVER: {
        fetch: async (asked: Request) => {
          sent.push(asked);
          return new Response(null, { status: 204 });
        },
      },
    };
    const { wrapped } = tagCache();
    await wrapped.writeTags(["_N_T_/acme/demo", "diagram:acme/demo"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("POST");
    expect(new URL(sent[0]!.url).pathname).toBe(CACHE_ENTRY_PATH);
    expect(sent[0]!.headers.get("authorization")).toBe("Bearer s3cret");
    expect(await sent[0]!.json()).toEqual({ drop: ["/acme/demo"] });

    // Nothing to drop: nothing is sent.
    await wrapped.writeTags(["diagram:acme/demo"]);
    expect(sent).toHaveLength(1);
  });

  it("asks whether the tags are stale alongside whether they were revalidated", async () => {
    const { inner, wrapped } = tagCache();
    const tags = ["_N_T_/acme/demo"];
    expect(await wrapped.hasBeenRevalidated(tags, 1000)).toBe(false);
    expect(inner.isStale).toHaveBeenCalledTimes(1);
    expect(await wrapped.isStale!(tags, 1000)).toBe(true);
    // Collected, not asked again.
    expect(inner.isStale).toHaveBeenCalledTimes(1);
    // A question nobody prepared is asked directly.
    expect(await wrapped.isStale!(tags, 2000)).toBe(true);
    expect(inner.isStale).toHaveBeenCalledTimes(2);
  });
});

describe("withBackgroundSend", () => {
  it("sends after the response, once per revalidation", async () => {
    let finish: () => void = () => undefined;
    const inner = {
      name: "fake",
      send: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    };
    const queue = withBackgroundSend(inner as unknown as Queue);
    const message = {
      MessageBody: { host: "gitdiagram.com", url: "/acme/demo" },
      MessageDeduplicationId: "a",
      MessageGroupId: "g",
    };
    // Resolves without waiting for the queue.
    await queue.send(message as never);
    await queue.send(message as never);
    expect(inner.send).toHaveBeenCalledTimes(1);
    finish();
    await settle();

    vi.advanceTimersByTime(61_000);
    await queue.send(message as never);
    expect(inner.send).toHaveBeenCalledTimes(2);
    finish();
    await settle();
  });
});

const tagCacheFor = () => ({
  wrapped: withColoPurge({
    mode: "nextMode",
    name: "fake",
    getLastRevalidated: async () => 0,
    writeTags: async () => undefined,
    hasBeenRevalidated: async () => false,
    isStale: async () => false,
  } as unknown as NextModeTagCache),
});

const realImmediate = globalThis.setImmediate;

describe("answerFromCopy", () => {
  const env = { CRON_SECRET: "s3cret", SITE_ORIGIN: "https://gitdiagram.com" };
  const waiting: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (work: Promise<unknown>) => void waiting.push(work),
  };
  const ask = (
    path: string,
    headers: Record<string, string> = {},
    method = "GET",
  ) => {
    const url = new URL(path, "https://gitdiagram.com");
    return answerFromCopy(
      new Request(url, { method, headers }),
      url,
      env,
      ctx,
      "no-build-id",
    );
  };
  const appPage = (overrides: Record<string, unknown> = {}) => ({
    type: "app",
    html: "<!DOCTYPE html><p>hello</p>",
    rsc: "0:{}",
    revalidate: 300,
    meta: {
      headers: {
        "x-nextjs-stale-time": "300",
        "x-next-cache-tags": "_N_T_/acme/demo",
      },
    },
    ...overrides,
  });
  const hold = (key: string, value: unknown) =>
    withColoCache(fakeStore({})).set(key, value as never);

  beforeEach(() => {
    waiting.length = 0;
  });

  it("answers a held page as OpenNext's cache interceptor would", async () => {
    await hold("/acme/demo", appPage());
    vi.advanceTimersByTime(100_000);
    const response = await ask("/acme/demo?utm_source=x");
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe("<!DOCTYPE html><p>hello</p>");
    expect(Object.fromEntries(response!.headers)).toEqual({
      "cache-control": "s-maxage=200, stale-while-revalidate=2592000",
      "content-type": "text/html; charset=utf-8",
      // md5 of the body, quoted.
      etag: '"d3700297557844f664c6d740fa566557"',
      vary: "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url",
      "x-nextjs-stale-time": "300",
      "x-opennext-cache": "HIT",
    });
  });

  it("finds the home page and paths with a trailing slash", async () => {
    await hold("/index", appPage());
    await hold("/videos", appPage({ revalidate: false }));
    expect(await ask("/")).not.toBeNull();
    const videos = await ask("/videos/");
    expect(videos!.headers.get("cache-control")).toBe(
      "s-maxage=31536000, stale-while-revalidate=2592000",
    );
  });

  it.each([
    ["an RSC request", "/acme/demo", { rsc: "1" }, "GET"],
    ["a forged Server Action", "/acme/demo", { "next-action": "x" }, "GET"],
    ["a revalidation", "/acme/demo", { "x-prerender-revalidate": "id" }, "GET"],
    ["a preview", "/acme/demo", { cookie: "a=1; __prerender_bypass=x" }, "GET"],
    [
      "an explicit full-path request",
      "/acme/demo",
      { [FULL_PATH_HEADER]: "1" },
      "GET",
    ],
    ["a HEAD", "/acme/demo", {}, "HEAD"],
    ["a POST", "/acme/demo", {}, "POST"],
    ["an encoded path", "/acme/de%6Do", {}, "GET"],
    ["a doubled slash", "/acme//demo", {}, "GET"],
    ["a page it does not hold", "/acme/other", {}, "GET"],
    ["a path that is never a page", "/api/video", {}, "GET"],
  ])("leaves %s to the routing layer", async (_name, path, headers, method) => {
    await hold("/acme/demo", appPage());
    await hold("/api/video", appPage());
    expect(await ask(path, headers, method)).toBeNull();
  });

  it.each([
    ["a route answer", { type: "route", body: "x", html: undefined }],
    ["an error page", { meta: { status: 404, headers: {} } }],
    ["an entry without a lifetime", { revalidate: undefined }],
  ])("leaves %s to the routing layer", async (_name, overrides) => {
    await hold("/acme/demo", appPage(overrides));
    expect(await ask("/acme/demo")).toBeNull();
  });

  it("is kept in step with the entry: replaced, dropped, or removed with it", async () => {
    const cache = withColoCache(fakeStore({}));
    await cache.set("/acme/demo", appPage() as never);
    // The entry (for OpenNext) and the finished page (for the edge Worker).
    expect(held.size).toBe(2);
    expect(await ask("/acme/demo")).not.toBeNull();

    // The page now renders an error: nothing finished is kept for it.
    await cache.set(
      "/acme/demo",
      appPage({ meta: { status: 404, headers: {} } }) as never,
    );
    expect(held.size).toBe(1);
    expect(await ask("/acme/demo")).toBeNull();

    await cache.set("/acme/demo", appPage() as never);
    const { wrapped } = tagCacheFor();
    await wrapped.writeTags(["_N_T_/acme/demo"]);
    expect(held.size).toBe(0);
    expect(await ask("/acme/demo")).toBeNull();
  });

  it("answers from the entry the server hands over, and keeps it", async () => {
    const response = await answerFromEntry(
      "/acme/demo",
      entryResponse({ value: appPage(), lastModified: Date.now() - 100_000 }),
      env,
      ctx,
      "no-build-id",
    );
    expect(await response!.text()).toBe("<!DOCTYPE html><p>hello</p>");
    expect(Object.fromEntries(response!.headers)).toEqual({
      "cache-control": "s-maxage=200, stale-while-revalidate=2592000",
      "content-type": "text/html; charset=utf-8",
      etag: '"d3700297557844f664c6d740fa566557"',
      vary: "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url",
      "x-nextjs-stale-time": "300",
      "x-opennext-cache": "HIT",
    });
    await Promise.all(waiting);
    // Both forms are here now: the next request is answered locally.
    expect(held.size).toBe(2);
    expect(await ask("/acme/demo")).not.toBeNull();
  });

  it.each([
    ["a route answer", { type: "route", body: "x", html: undefined }],
    ["a page past its lifetime", { revalidate: 50 }],
  ])(
    "keeps %s the server hands over but leaves the answer to the routing layer",
    async (_name, overrides) => {
      const response = await answerFromEntry(
        "/acme/demo",
        entryResponse({
          value: appPage(overrides),
          lastModified: Date.now() - 100_000,
        }),
        env,
        ctx,
        "no-build-id",
      );
      expect(response).toBeNull();
      await Promise.all(waiting);
      expect(held.size).toBeGreaterThan(0);
    },
  );

  it("answers nothing from something that is not an entry", async () => {
    expect(
      await answerFromEntry(
        "/acme/demo",
        new Response("<html>"),
        env,
        ctx,
        "no-build-id",
      ),
    ).toBeNull();
  });

  it("leaves a page past its lifetime to the routing layer, which queues its re-render", async () => {
    await hold("/acme/demo", appPage());
    vi.advanceTimersByTime(298_000);
    expect(await ask("/acme/demo")).not.toBeNull();
    // OpenNext calls a page stale from its last second on.
    vi.advanceTimersByTime(1_000);
    expect(await ask("/acme/demo")).toBeNull();
  });

  it("answers a page past its lifetime stale when it can restart its render, and follows the new render", async () => {
    const asked: Request[] = [];
    let restarts = 0;
    let rendered = false;
    let heldAt = 0;
    const bound = {
      ...env,
      SERVER: {
        fetch: async (sent: Request) => {
          asked.push(sent);
          return entryResponse(
            rendered
              ? {
                  value: appPage({ html: "<p>new</p>" }),
                  lastModified: Date.now(),
                }
              : { value: appPage(), lastModified: heldAt },
          );
        },
      },
    };
    const get = () => {
      const url = new URL("/acme/stale", "https://gitdiagram.com");
      return answerFromCopy(
        new Request(url),
        url,
        bound,
        ctx,
        "no-build-id",
        async () => void restarts++,
      );
    };
    heldAt = Date.now();
    await hold("/acme/stale", appPage());
    vi.advanceTimersByTime(400_000);
    const stale = await get();
    expect(await stale!.text()).toContain("hello");
    expect(stale!.headers.get("cache-control")).toBe(
      "s-maxage=1, stale-while-revalidate=2592000",
    );
    expect(stale!.headers.get("x-opennext-cache")).toBe("STALE");
    // Asked for once, however many visitors come meanwhile.
    expect((await get())!.headers.get("x-opennext-cache")).toBe("STALE");
    // The clock moves on while real work (the entry's decompression) lands.
    const until = async (done: () => boolean) => {
      for (let step = 0; step < 200 && !done(); step++) {
        await vi.advanceTimersByTimeAsync(100);
        await new Promise((resolve) => realImmediate(resolve));
      }
    };
    await until(() => asked.length === 1);
    expect(restarts).toBe(1);
    expect(asked).toHaveLength(1);
    // The render lands; the next look takes it.
    rendered = true;
    await until(() => asked.length === 2);
    await Promise.all(waiting);
    expect(asked).toHaveLength(2);
    const fresh = await get();
    expect(await fresh!.text()).toBe("<p>new</p>");
    expect(fresh!.headers.get("x-opennext-cache")).toBe("HIT");
    expect(restarts).toBe(1);
  });

  it("rechecks an old copy with the server after answering from it", async () => {
    const asked: Request[] = [];
    let answer = () =>
      entryResponse({
        value: appPage({ html: "<p>new</p>" }),
        lastModified: Date.now(),
      });
    const bound = {
      ...env,
      SERVER: {
        fetch: async (sent: Request) => {
          asked.push(sent);
          return answer();
        },
      },
    };
    const get = (path: string) => {
      const url = new URL(path, "https://gitdiagram.com");
      return answerFromCopy(new Request(url), url, bound, ctx, "no-build-id");
    };
    await hold("/acme/demo", appPage());
    vi.advanceTimersByTime(20_000);
    await get("/acme/demo");
    expect(asked).toHaveLength(0);

    vi.advanceTimersByTime(11_000);
    expect(await (await get("/acme/demo"))!.text()).toContain("hello");
    await Promise.all(waiting);
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]!.url).searchParams.get("fresh")).toBe("1");
    expect(await (await get("/acme/demo"))!.text()).toBe("<p>new</p>");

    // Revalidated: the copy goes, and the next request takes the long way.
    vi.advanceTimersByTime(31_000);
    answer = () => new Response(null, { status: 404 });
    await get("/acme/demo");
    await Promise.all(waiting);
    expect(await get("/acme/demo")).toBeNull();
  });
});

describe("plainPageKey", () => {
  const key = (path: string, init: RequestInit = {}) => {
    const url = new URL(path, "https://gitdiagram.com");
    return plainPageKey(new Request(url, init), url);
  };

  it("is the page's cache key for a plain GET", () => {
    expect(key("/")).toBe("/index");
    expect(key("/videos/")).toBe("/videos");
    expect(key("/vercel/next.js?utm_source=x")).toBe("/vercel/next.js");
  });

  it("is null for anything the routing layer must see", () => {
    expect(key("/acme/demo", { method: "HEAD" })).toBeNull();
    expect(key("/acme/demo", { headers: { rsc: "1" } })).toBeNull();
    expect(key("/acme/de%6Do")).toBeNull();
    expect(key("/api/video")).toBeNull();
    expect(key("/sitemap/0.xml")).toBeNull();
  });
});
