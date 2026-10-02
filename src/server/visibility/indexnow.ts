import "server-only";

import { after } from "next/server";

import { SITE_URL } from "~/lib/site";
import { logEvent } from "~/server/log";

// IndexNow tells Bing (whose index ChatGPT search reads), Yandex, Seznam and
// Naver that a page changed, instead of waiting for the next crawl. The key is
// public by design: /<key>.txt serves it (a rewrite in next.config.js to
// /api/indexnow-key) to prove the site owns the submissions.

// Tried in order until one accepts. Every IndexNow engine passes what it
// receives on to the others, so one acceptance is enough. The shared endpoint
// (run by Bing) answers 429 to every call from Cloudflare Workers' shared
// addresses (29 of 29 on the day of the move; 200 from elsewhere), where
// Yandex and Seznam accept.
const ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://yandex.com/indexnow",
  "https://search.seznam.cz/indexnow",
];
const MAX_URLS = 10_000;
const TIMEOUT_MS = 5_000;

/** The IndexNow key, or null when unset or not a valid key (8-128 of a-z, A-Z, 0-9, -). */
export function indexNowKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim() ?? "";
  return /^[A-Za-z0-9-]{8,128}$/.test(key) ? key : null;
}

function enabled() {
  return (
    indexNowKey() !== null &&
    (process.env.VERCEL_ENV === "production" ||
      process.env.INDEXNOW_ENABLED === "1")
  );
}

/** Only this site's own absolute URLs, once each. */
function ownUrls(urls: string[]): string[] {
  const host = new URL(SITE_URL).host;
  const kept = new Set<string>();
  for (const url of urls) {
    try {
      if (new URL(url).host === host) kept.add(url);
    } catch {
      // Not a URL.
    }
  }
  return [...kept].slice(0, MAX_URLS);
}

async function submit(urls: string[]): Promise<void> {
  const key = indexNowKey();
  const urlList = ownUrls(urls);
  if (!key || !urlList.length) return;
  const body = JSON.stringify({
    host: new URL(SITE_URL).host,
    key,
    keyLocation: `${SITE_URL}/${key}.txt`,
    urlList,
  });
  const refused: number[] = [];
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await response.body?.cancel().catch(() => undefined);
      // 200 and 202 both mean received; 429 means slow down.
      if (response.ok) return;
      refused.push(response.status);
    } catch {
      // Best effort: crawlers still find the page through the sitemap.
      refused.push(0);
    }
  }
  logEvent("warn", "indexnow.rejected", {
    status: refused[0],
    statuses: refused.join(","),
    urls: urlList.length,
  });
}

/**
 * Tell search engines these pages changed. Never throws and never delays the
 * caller: inside a request it runs after the response (after()). Only in
 * production (or with INDEXNOW_ENABLED=1) and with INDEXNOW_KEY set.
 */
export function notifyIndexNow(urls: string[]): Promise<void> {
  if (!enabled()) return Promise.resolve();
  const task = submit(urls);
  try {
    after(task);
  } catch {
    // Outside a request scope: the caller keeps the process alive.
  }
  return task;
}
