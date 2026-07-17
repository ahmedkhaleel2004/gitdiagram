import { afterEach, describe, expect, it } from "vitest";

import {
  cacheDiagramPreview,
  clearDiagramPreviewCacheForTest,
  formatGeneratedAt,
  formatGeneratedAtUtc,
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

describe("browse generated timestamps", () => {
  it("provides a deterministic UTC label for server rendering", () => {
    expect(formatGeneratedAtUtc("2026-07-17T05:36:00.000Z")).toBe(
      "Jul 17, 2026, 5:36 AM UTC",
    );
    expect(formatGeneratedAtUtc("2026-07-17T17:06:00.000Z")).toBe(
      "Jul 17, 2026, 5:06 PM UTC",
    );
  });

  it("handles malformed stored timestamps without crashing the catalog", () => {
    expect(formatGeneratedAt("not-a-date")).toBe("Unknown");
    expect(formatGeneratedAtUtc("not-a-date")).toBe("Unknown");
  });
});
