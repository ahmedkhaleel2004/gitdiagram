import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chunkReloadScript } from "./chunk-reload";

type Listener = (event: unknown) => void;

function fakeWindow(storage: Storage | null = window.sessionStorage) {
  const listeners = new Map<string, Listener[]>();
  const reload = vi.fn();
  const documentElement = document.createElement("html");
  const win = {
    document: { documentElement },
    location: { reload },
    get sessionStorage() {
      if (!storage) throw new Error("SecurityError");
      return storage;
    },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  // Runs the serialized script, exactly as the page does.
  new Function("window", chunkReloadScript)(win);
  const emit = (type: string, event: unknown) =>
    listeners.get(type)?.forEach((listener) => listener(event));
  return { reload, documentElement, emit };
}

function chunkError() {
  const error = new Error(
    "Failed to load chunk /_next/static/immutable/chunks/abc.js from module 1",
  );
  error.name = "ChunkLoadError";
  return error;
}

describe("chunk reload", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads once for a failed chunk, from an error or a rejection", () => {
    const page = fakeWindow();
    page.emit("unhandledrejection", { reason: chunkError() });
    expect(page.reload).toHaveBeenCalledOnce();

    // The reloaded page fails again: no second reload, so no loop.
    const reloaded = fakeWindow();
    reloaded.emit("error", { error: chunkError() });
    reloaded.emit("error", { message: "Loading chunk 42 failed." });
    expect(reloaded.reload).not.toHaveBeenCalled();
  });

  it("reloads again only after ten minutes", () => {
    fakeWindow().emit("error", { error: chunkError() });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    const later = fakeWindow();
    later.emit("unhandledrejection", {
      reason: new TypeError(
        "Failed to fetch dynamically imported module: https://x/a.js",
      ),
    });
    expect(later.reload).toHaveBeenCalledOnce();
  });

  it("ignores other errors", () => {
    const page = fakeWindow();
    page.emit("error", { error: new TypeError("x is undefined") });
    page.emit("unhandledrejection", {
      reason: "Object Not Found Matching Id:1",
    });
    page.emit("unhandledrejection", { reason: undefined });
    expect(page.reload).not.toHaveBeenCalled();
  });

  it("never reloads while a diagram is generating", () => {
    const page = fakeWindow();
    page.documentElement.setAttribute("data-generating", "");
    page.emit("error", { error: chunkError() });
    expect(page.reload).not.toHaveBeenCalled();
  });

  it("never reloads without storage for its guard", () => {
    const page = fakeWindow(null);
    page.emit("error", { error: chunkError() });
    expect(page.reload).not.toHaveBeenCalled();
  });
});
