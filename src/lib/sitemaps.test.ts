import { describe, expect, it } from "vitest";

import { getSitemapCount, SITEMAP_PAGE_SIZE } from "~/lib/sitemaps";

describe("sitemap pagination", () => {
  it("accounts for all four static routes at the page boundary", () => {
    expect(getSitemapCount(SITEMAP_PAGE_SIZE - 4)).toBe(1);
    expect(getSitemapCount(SITEMAP_PAGE_SIZE - 3)).toBe(2);
  });
});
