import { afterEach, describe, expect, it } from "vitest";

import {
  cacheDiagramPreview,
  clearDiagramPreviewCacheForTest,
  getCachedDiagramPreview,
} from "~/components/browse-catalog-shared";

describe("browse diagram preview cache", () => {
  afterEach(() => {
    clearDiagramPreviewCacheForTest();
  });

  it("bounds cached diagrams and keeps recently read entries", () => {
    for (let index = 0; index <= 60; index += 1) {
      cacheDiagramPreview(`owner/repo-${index}`, `diagram-${index}`);
    }

    expect(getCachedDiagramPreview("owner/repo-0")).toBeUndefined();
    expect(getCachedDiagramPreview("owner/repo-1")).toBe("diagram-1");

    cacheDiagramPreview("owner/repo-61", "diagram-61");

    expect(getCachedDiagramPreview("owner/repo-1")).toBe("diagram-1");
    expect(getCachedDiagramPreview("owner/repo-2")).toBeUndefined();
  });
});
