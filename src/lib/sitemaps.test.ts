import { describe, expect, it } from "vitest";

import { getSitemapCount, SITEMAP_PAGE_SIZE } from "~/lib/sitemaps";

describe("sitemap pagination", () => {
  it("accounts for the fixed routes at the page boundary", () => {
    // With videos on there are four fixed pages.
    expect(getSitemapCount(SITEMAP_PAGE_SIZE - 4, 4)).toBe(1);
    expect(getSitemapCount(SITEMAP_PAGE_SIZE - 3, 4)).toBe(2);
    // With videos off, three: no empty second page at the boundary.
    expect(getSitemapCount(SITEMAP_PAGE_SIZE - 3, 3)).toBe(1);
    expect(getSitemapCount(SITEMAP_PAGE_SIZE - 2, 3)).toBe(2);
  });
});
