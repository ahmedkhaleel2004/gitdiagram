"use client";

import {
  buildBrowseSearchParams,
  normalizeBrowseQuery,
  type BrowsePageResult,
  type BrowseQuery,
} from "./catalog";

const browsePageCache = new Map<string, BrowsePageResult | null>();
const browsePagePromises = new Map<string, Promise<BrowsePageResult | null>>();

function getBrowsePageUrl(query: BrowseQuery) {
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
  signal?: AbortSignal,
): Promise<BrowsePageResult | null> {
  const response = await fetch(getBrowsePageUrl(query), {
    credentials: "same-origin",
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

export async function loadBrowsePage(
  query: BrowseQuery,
  signal?: AbortSignal,
): Promise<BrowsePageResult | null> {
  const url = getBrowsePageUrl(query);
  const cachedPage = browsePageCache.get(url);
  if (cachedPage !== undefined) {
    return cachedPage;
  }

  if (!signal && browsePagePromises.has(url)) {
    return browsePagePromises.get(url)!;
  }

  const promise = fetchBrowsePage(query, signal)
    .then((result) => {
      browsePageCache.set(url, result);
      return result;
    })
    .finally(() => {
      if (!signal) {
        browsePagePromises.delete(url);
      }
    });

  if (!signal) {
    browsePagePromises.set(url, promise);
  }

  return promise;
}

export function clearBrowsePageCacheForTest() {
  browsePageCache.clear();
  browsePagePromises.clear();
}
