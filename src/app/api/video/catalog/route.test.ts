// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  getVideoPage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => mocks.enabled,
}));
vi.mock("~/server/explainer/catalog", () => ({
  getVideoPage: mocks.getVideoPage,
}));

import { GET } from "./route";

const get = (query: string) =>
  GET(new Request(`https://gitdiagram.com/api/video/catalog${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/video/catalog", () => {
  it("answers one page of the gallery for the query, cached briefly", async () => {
    mocks.getVideoPage.mockResolvedValue({ cards: [], total: 0, page: 2 });
    const response = await get(
      `?q=${"x".repeat(300)}&sort=stars_desc&minStars=100&page=2`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [], total: 0, page: 2 });
    expect(mocks.getVideoPage).toHaveBeenCalledWith({
      q: "x".repeat(100),
      sort: "stars_desc",
      minStars: "100",
      page: "2",
    });
    expect(response.headers.get("cache-control")).toContain("max-age=60");
  });

  it("fails without caching when the videos cannot be listed", async () => {
    mocks.getVideoPage.mockRejectedValue(new Error("R2 down"));
    const response = await get("");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is not found while explainer videos are off", async () => {
    mocks.enabled = false;
    expect((await get("")).status).toBe(404);
    expect(mocks.getVideoPage).not.toHaveBeenCalled();
  });
});
