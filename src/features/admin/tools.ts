"use client";

import { useSyncExternalStore } from "react";

// Operator tools on public pages (for now, "Regenerate video" on every video)
// show only in a browser where the operator has turned them on from /admin, so
// by default the operator sees pages exactly as visitors do. The switch lives
// in this browser alone; the server still checks the admin session on every
// action.

const KEY = "gd:admin-tools";
const CHANGED = "gd:admin-tools-changed";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  // "storage" covers other tabs; CHANGED covers this one.
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function setAdminTools(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the tools just stay off.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Whether this browser shows operator tools on public pages. */
export function useAdminTools(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
