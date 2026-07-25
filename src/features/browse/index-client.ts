"use client";

import {
  buildBrowseSearchParams,
  normalizeBrowseQuery,
  type BrowsePageResult,
  type BrowseQuery,
} from "./catalog";

interface CachedBrowsePage {
  expiresAt: number;
  page: BrowsePageResult | null;
}

interface PendingBrowsePage {
  controller: AbortController;
  promise: Promise<BrowsePageResult | null>;
  settled: boolean;
  waiters: number;
}

const browsePageCache = new Map<string, CachedBrowsePage>();
const browsePagePromises = new Map<string, PendingBrowsePage>();
const MAX_CACHED_BROWSE_PAGES = 100;
const BROWSE_PAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const MISSING_BROWSE_PAGE_CACHE_TTL_MS = 30 * 1000;

function getCachedBrowsePage(url: string) {
  if (!browsePageCache.has(url)) {
    return undefined;
  }

  const cachedPage = browsePageCache.get(url);
  browsePageCache.delete(url);
  if (!cachedPage || cachedPage.expiresAt <= Date.now()) {
    return undefined;
  }
  browsePageCache.set(url, cachedPage);
  return cachedPage.page;
}

function cacheBrowsePage(url: string, page: BrowsePageResult | null) {
  browsePageCache.delete(url);
  browsePageCache.set(url, {
    page,
    expiresAt:
      Date.now() +
      (page ? BROWSE_PAGE_CACHE_TTL_MS : MISSING_BROWSE_PAGE_CACHE_TTL_MS),
  });

  while (browsePageCache.size > MAX_CACHED_BROWSE_PAGES) {
    const oldestUrl = browsePageCache.keys().next().value;
    if (oldestUrl === undefined) {
      break;
    }
    browsePageCache.delete(oldestUrl);
  }
}

export function getBrowsePageUrl(query: BrowseQuery) {
  const normalizedQuery = normalizeBrowseQuery(query);
  const params = buildBrowseSearchParams({
    q: normalizedQuery.q,
    sort: normalizedQuery.sort,
    minStars: normalizedQuery.minStars,
    page: normalizedQuery.page,
  });
  const queryString = params.toString();
  return queryString ? `/api/browse-index?${queryString}` : "/api/browse-index";
}

async function fetchBrowsePage(
  query: BrowseQuery,
  signal: AbortSignal,
): Promise<BrowsePageResult | null> {
  const response = await fetch(getBrowsePageUrl(query), {
    credentials: "omit",
    signal,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load browse index (${response.status}).`);
  }

  return (await response.json()) as BrowsePageResult;
}

function waitForBrowsePage(
  pending: PendingBrowsePage,
  signal?: AbortSignal,
): Promise<BrowsePageResult | null> {
  if (signal?.aborted) {
    return Promise.reject(
      new DOMException("The request was aborted.", "AbortError"),
    );
  }

  pending.waiters += 1;
  return new Promise<BrowsePageResult | null>((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", handleAbort);
      pending.waiters = Math.max(0, pending.waiters - 1);
      if (!pending.settled && pending.waiters === 0) {
        pending.controller.abort();
      }
    };
    const handleAbort = () => {
      finish();
      reject(new DOMException("The request was aborted.", "AbortError"));
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    pending.promise.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error: unknown) => {
        finish();
        reject(error);
      },
    );
  });
}

export async function loadBrowsePage(
  query: BrowseQuery,
  signal?: AbortSignal,
): Promise<BrowsePageResult | null> {
  const url = getBrowsePageUrl(query);
  const cachedPage = getCachedBrowsePage(url);
  if (cachedPage !== undefined) {
    return cachedPage;
  }

  const pendingPage = browsePagePromises.get(url);
  if (pendingPage) {
    return waitForBrowsePage(pendingPage, signal);
  }

  const controller = new AbortController();
  const pending: PendingBrowsePage = {
    controller,
    promise: Promise.resolve(null),
    settled: false,
    waiters: 0,
  };
  const promise = fetchBrowsePage(query, controller.signal)
    .then((result) => {
      cacheBrowsePage(url, result);
      return result;
    })
    .finally(() => {
      pending.settled = true;
      if (browsePagePromises.get(url) === pending) {
        browsePagePromises.delete(url);
      }
    });

  pending.promise = promise;
  browsePagePromises.set(url, pending);

  return waitForBrowsePage(pending, signal);
}

export function clearBrowsePageCacheForTest() {
  browsePageCache.clear();
  for (const pending of browsePagePromises.values()) {
    pending.controller.abort();
  }
  browsePagePromises.clear();
}
