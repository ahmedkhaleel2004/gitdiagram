import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { videoVersion } from "./store";

describe("explainer video storage", () => {
  it("names a video's file folder after its creation time", () => {
    expect(videoVersion("2026-09-24T08:06:45.297Z")).toBe("1790237205297");
    expect(videoVersion("not a date")).toBeNull();
  });
});
