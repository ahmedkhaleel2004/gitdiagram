import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  readVoiceClip: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: mocks.enabled,
}));
vi.mock("~/server/explainer/store", () => ({
  readVoiceClip: mocks.readVoiceClip,
}));

import { GET } from "./route";

const v = "2026-09-24T08:06:45.297Z";
const get = (query: Record<string, string> = {}) =>
  GET(
    new Request(
      `https://gitdiagram.com/api/video/audio?${new URLSearchParams({
        username: "acme",
        repo: "widget",
        beat: "0",
        v,
        ...query,
      }).toString()}`,
    ),
  );

afterEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
});

describe("GET /api/video/audio", () => {
  it("serves a take as MP3 that can be cached forever", async () => {
    mocks.readVoiceClip.mockResolvedValue(Buffer.from("mp3 bytes"));
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, s-maxage=31536000, immutable",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
      "mp3 bytes",
    );
    expect(mocks.readVoiceClip).toHaveBeenCalledWith("acme", "widget", v, 0);
  });

  it("still serves an older video's later clips", async () => {
    mocks.readVoiceClip.mockResolvedValue(Buffer.from("mp3"));
    expect((await get({ beat: "5" })).status).toBe(200);
    expect(mocks.readVoiceClip).toHaveBeenCalledWith("acme", "widget", v, 5);
  });

  it("answers 404 for a clip that is not stored", async () => {
    mocks.readVoiceClip.mockResolvedValue(null);
    const response = await get();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).not.toContain("immutable");
  });

  it("answers 404 while explainer videos are off", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await get()).status).toBe(404);
    expect(mocks.readVoiceClip).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { beat: "-1" },
    { beat: "32" },
    { beat: "1.5" },
    { beat: "one" },
    { v: "yesterday" },
    { username: "-bad-" },
    { repo: "../etc" },
  ])("rejects a bad request %o", async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(mocks.readVoiceClip).not.toHaveBeenCalled();
  });
});
