"use client";

import type { BrowseIndexEntry } from "./catalog";

let browseIndexEntries: BrowseIndexEntry[] | null = null;
let browseIndexPromise: Promise<BrowseIndexEntry[] | null> | null = null;

async function fetchBrowseIndex(): Promise<BrowseIndexEntry[] | null> {
  const response = await fetch("/api/browse-index", {
    credentials: "same-origin",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load browse index (${response.status}).`);
  }

  return (await response.json()) as BrowseIndexEntry[];
}

export async function preloadBrowseIndex(): Promise<BrowseIndexEntry[] | null> {
  if (browseIndexEntries) {
    return browseIndexEntries;
  }

  if (!browseIndexPromise) {
    browseIndexPromise = fetchBrowseIndex()
      .then((entries) => {
        browseIndexEntries = entries;
        return entries;
      })
      .finally(() => {
        browseIndexPromise = null;
      });
  }

  return browseIndexPromise;
}
