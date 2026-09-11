import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBrowsePageCacheForTest,
  loadBrowsePage,
} from "~/features/browse/index-client";
import type { BrowsePageResult } from "~/features/browse/catalog";

const result: BrowsePageResult = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  sort: "recent_desc",
  q: "vercel",
  minStars: 0,
};

describe("browse page client cache", () => {
  afterEach(() => {
    clearBrowsePageCacheForTest();
    vi.restoreAllMocks();
  });

  it("deduplicates equal in-flight queries while callers cancel independently", async () => {
    let resolveResponse!: (response: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchSpy = vi.spyOn(global, "fetch").mockReturnValue(responsePromise);
    const firstController = new AbortController();

    const first = loadBrowsePage({ q: "vercel" }, firstController.signal);
    const second = loadBrowsePage({ q: "vercel" });
    firstController.abort();
    resolveResponse(Response.json(result));

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toEqual(result);
    await expect(loadBrowsePage({ q: "vercel" })).resolves.toEqual(result);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual({
      credentials: "omit",
      signal: expect.any(AbortSignal),
    });
  });

  it("bounds completed browse query results", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async () => Response.json(result));

    for (let index = 0; index <= 100; index += 1) {
      await loadBrowsePage({ q: `repo-${index}` });
    }
    await loadBrowsePage({ q: "repo-0" });

    expect(fetchSpy).toHaveBeenCalledTimes(102);
  });

  it("aborts the underlying request once every waiter cancels", async () => {
    let underlyingSignal: AbortSignal | undefined;
    vi.spyOn(global, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          underlyingSignal = init?.signal as AbortSignal;
          underlyingSignal.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The request was aborted.", "AbortError"),
              ),
            { once: true },
          );
        }),
    );
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = loadBrowsePage({ q: "vercel" }, firstController.signal);
    const second = loadBrowsePage({ q: "vercel" }, secondController.signal);
    firstController.abort();
    expect(underlyingSignal?.aborted).toBe(false);
    secondController.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(underlyingSignal?.aborted).toBe(true);
  });

  it("refreshes a cached page after its five-minute TTL", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async () => Response.json(result));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);

    await loadBrowsePage({ q: "vercel" });
    await loadBrowsePage({ q: "vercel" });
    expect(fetchSpy).toHaveBeenCalledOnce();

    now.mockReturnValue(5 * 60 * 1_000 + 1_001);
    await loadBrowsePage({ q: "vercel" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
