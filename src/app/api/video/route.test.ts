// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAdmissionControls: vi.fn(),
  reportHeldBack: vi.fn(),
  readVideoArtifact: vi.fn(),
  isVideoLockHeld: vi.fn(),
  videosLeftToday: vi.fn(),
  hasNarrationCredits: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/admin/controls", () => ({
  readAdmissionControls: mocks.readAdmissionControls,
}));
vi.mock("~/server/explainer/gate-notice", () => ({
  reportHeldBack: mocks.reportHeldBack,
}));
vi.mock("~/server/explainer/config", () => ({
  canGenerateVideos: () => true,
  isVideoExplainerEnabled: () => true,
}));
vi.mock("~/server/explainer/limits", () => ({
  generationLockName: (u: string, r: string) => `generate:${u}/${r}`,
  isVideoAdmin: () => false,
  isVideoLockHeld: mocks.isVideoLockHeld,
  videosLeftToday: mocks.videosLeftToday,
}));
vi.mock("~/server/explainer/narration", () => ({
  hasNarrationCredits: mocks.hasNarrationCredits,
}));
vi.mock("~/server/explainer/store", () => ({
  readVideoArtifact: mocks.readVideoArtifact,
}));

import { GET } from "./route";

const get = () =>
  GET(new Request("https://gitdiagram.com/api/video?username=acme&repo=demo"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  mocks.readAdmissionControls.mockResolvedValue({
    videoAudience: "everyone",
    videosPaused: false,
  });
  mocks.readVideoArtifact.mockResolvedValue(null);
  mocks.isVideoLockHeld.mockResolvedValue(false);
  mocks.videosLeftToday.mockResolvedValue(5);
  mocks.hasNarrationCredits.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/video", () => {
  it("says when a video is being made, uncached", async () => {
    mocks.isVideoLockHeld.mockResolvedValue(true);
    const response = await get();
    expect(await response.json()).toMatchObject({
      video: null,
      generating: true,
      canGenerate: true,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.isVideoLockHeld).toHaveBeenCalledWith("generate:acme/demo");
  });

  it("names a new browser, but never on the cached answer", async () => {
    const fresh = await get();
    expect(fresh.headers.get("set-cookie")).toContain("gd_visitor=");
    mocks.readVideoArtifact.mockResolvedValue({ repository: "acme/demo" });
    const cached = await get();
    expect(cached.headers.get("cache-control")).toContain("s-maxage");
    expect(cached.headers.get("set-cookie")).toBeNull();
  });

  it("offers no new video when the live controls cannot be read", async () => {
    mocks.readAdmissionControls.mockRejectedValue(new Error("redis down"));
    expect(await (await get()).json()).toMatchObject({
      canGenerate: false,
      paused: "limit",
      generating: false,
    });
  });

  it("reports a held-back visitor through the deduplicated notice", async () => {
    mocks.readAdmissionControls.mockResolvedValue({
      videoAudience: "priority",
      videosPaused: false,
    });
    expect(await (await get()).json()).toMatchObject({
      canGenerate: false,
      paused: "audience",
    });
    expect(mocks.reportHeldBack).toHaveBeenCalledWith(expect.any(Request), {
      username: "acme",
      repo: "demo",
      reason: "place",
      step: "page",
    });
  });
});
