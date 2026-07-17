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
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual({ credentials: "omit" });
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
});
