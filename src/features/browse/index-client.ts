"use client";

import {
  buildBrowseSearchParams,
  normalizeBrowseQuery,
  type BrowsePageResult,
  type BrowseQuery,
} from "./catalog";

const browsePageCache = new Map<string, BrowsePageResult | null>();
const browsePagePromises = new Map<string, Promise<BrowsePageResult | null>>();
const MAX_CACHED_BROWSE_PAGES = 100;

function getCachedBrowsePage(url: string) {
  if (!browsePageCache.has(url)) {
    return undefined;
  }

  const cachedPage = browsePageCache.get(url) ?? null;
  browsePageCache.delete(url);
  browsePageCache.set(url, cachedPage);
  return cachedPage;
}

function cacheBrowsePage(url: string, page: BrowsePageResult | null) {
  browsePageCache.delete(url);
  browsePageCache.set(url, page);

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
): Promise<BrowsePageResult | null> {
  const response = await fetch(getBrowsePageUrl(query), {
    credentials: "omit",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load browse index (${response.status}).`);
  }

  return (await response.json()) as BrowsePageResult;
}

function waitForBrowsePage<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(
      new DOMException("The request was aborted.", "AbortError"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(new DOMException("The request was aborted.", "AbortError"));
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
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

  const promise = fetchBrowsePage(query)
    .then((result) => {
      cacheBrowsePage(url, result);
      return result;
    })
    .finally(() => {
      if (browsePagePromises.get(url) === promise) {
        browsePagePromises.delete(url);
      }
    });

  browsePagePromises.set(url, promise);

  return waitForBrowsePage(promise, signal);
}

export function clearBrowsePageCacheForTest() {
  browsePageCache.clear();
  browsePagePromises.clear();
}
