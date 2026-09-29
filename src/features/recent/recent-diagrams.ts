"use client";

import { useSyncExternalStore } from "react";

/**
 * The public repositories this browser last opened a diagram for, newest
 * first, kept in localStorage so the home page can offer them again. Private
 * repositories are never added (callers only record a repository once its
 * public diagram is confirmed).
 */
export interface RecentDiagram {
  owner: string;
  repo: string;
  /** When the stored diagram was made, if known. */
  lastSuccessfulAt: string | null;
  /** When this browser last opened it (ms since the epoch). */
  viewedAt: number;
}

const STORAGE_KEY = "gitdiagram-recent-diagrams";
const CHANGE_EVENT = "gitdiagram:recent-diagrams";
export const MAX_RECENT_DIAGRAMS = 8;

// The server's rules for GitHub names (server/generate/types.ts), lowercased,
// so a tampered entry can never become anything but a repository path.
const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const REPO_PATTERN = /^[a-z0-9._-]{1,100}$/;
const EMPTY: readonly RecentDiagram[] = Object.freeze([]);

function isRecentDiagram(value: unknown): value is RecentDiagram {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.owner === "string" &&
    OWNER_PATTERN.test(entry.owner) &&
    typeof entry.repo === "string" &&
    REPO_PATTERN.test(entry.repo) &&
    entry.repo !== "." &&
    entry.repo !== ".." &&
    (entry.lastSuccessfulAt === null ||
      (typeof entry.lastSuccessfulAt === "string" &&
        entry.lastSuccessfulAt.length <= 64)) &&
    typeof entry.viewedAt === "number" &&
    Number.isFinite(entry.viewedAt)
  );
}

function parse(raw: string | null): readonly RecentDiagram[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    const seen = new Set<string>();
    const entries: RecentDiagram[] = [];
    for (const entry of value) {
      if (!isRecentDiagram(entry)) continue;
      const key = `${entry.owner}/${entry.repo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        owner: entry.owner,
        repo: entry.repo,
        lastSuccessfulAt: entry.lastSuccessfulAt,
        viewedAt: entry.viewedAt,
      });
      if (entries.length === MAX_RECENT_DIAGRAMS) break;
    }
    return entries;
  } catch {
    return EMPTY;
  }
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private modes, embedded browsers).
    return null;
  }
}

function write(entries: readonly RecentDiagram[]) {
  try {
    if (entries.length)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readRecentDiagrams(): readonly RecentDiagram[] {
  return parse(readRaw());
}

/** Put a public repository at the front of the list. */
export function recordRecentDiagram(entry: {
  owner: string;
  repo: string;
  lastSuccessfulAt?: string | null;
}) {
  const owner = entry.owner.toLowerCase();
  const repo = entry.repo.toLowerCase();
  const next: RecentDiagram = {
    owner,
    repo,
    lastSuccessfulAt: entry.lastSuccessfulAt ?? null,
    viewedAt: Date.now(),
  };
  if (!isRecentDiagram(next)) return;
  write(
    [
      next,
      ...readRecentDiagrams().filter(
        (item) => item.owner !== owner || item.repo !== repo,
      ),
    ].slice(0, MAX_RECENT_DIAGRAMS),
  );
}

export function clearRecentDiagrams() {
  write(EMPTY);
}

// useSyncExternalStore needs the same array back while storage is unchanged.
let cachedRaw: string | null = null;
let cachedEntries: readonly RecentDiagram[] = EMPTY;

function getSnapshot(): readonly RecentDiagram[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedEntries = parse(raw);
  }
  return cachedEntries;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * The recent list, empty on the server and during hydration, so a first-time
 * visitor's page is exactly the server's.
 */
export function useRecentDiagrams(): readonly RecentDiagram[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
