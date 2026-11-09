import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/browse-index-cache", () => ({
  getCachedBrowsePage: async () => null,
}));

import { generateMetadata } from "./page";

const metadataFor = (params: Record<string, string>) =>
  generateMetadata({ searchParams: Promise.resolve(params) });

describe("browse metadata", () => {
  it("lets a plain page of the newest diagrams be its own canonical", async () => {
    const page = await metadataFor({ page: "3" });
    expect(page.alternates?.canonical).toBe("/browse?page=3");
    expect(page.title).toBe("Browse Diagrams, page 3 | GitDiagram");
    expect((await metadataFor({})).alternates?.canonical).toBe("/browse");
  });

  it("points searches, filters and other sorts at /browse", async () => {
    for (const params of [
      { page: "2", q: "react" },
      { page: "2", sort: "stars_desc" },
      { page: "2", minStars: "100" },
    ] as Record<string, string>[])
      expect((await metadataFor(params)).alternates?.canonical).toBe("/browse");
  });
});
