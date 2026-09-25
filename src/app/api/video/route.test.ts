// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAdmissionControls: vi.fn(),
  reportHeldBack: vi.fn(),
  readVideoArtifact: vi.fn(),
  isVideoLockHeld: vi.fn(),
  videoLimitReached: vi.fn(),
  isNarrationAvailable: vi.fn(),
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
  videoLimitReached: mocks.videoLimitReached,
}));
vi.mock("~/server/explainer/narration", () => ({
  isNarrationAvailable: mocks.isNarrationAvailable,
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
  mocks.videoLimitReached.mockResolvedValue(null);
  mocks.isNarrationAvailable.mockResolvedValue(true);
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

  it("offers no new video once this visitor's own or connection's budget is spent", async () => {
    const visitor = "0b6f3a52-6a1f-4a8e-9a3c-2f0d7c1e5b44";
    const request = new Request(
      "https://gitdiagram.com/api/video?username=acme&repo=demo",
      {
        headers: {
          cookie: `gd_visitor=${visitor}`,
          "x-forwarded-for": "203.0.113.9",
        },
      },
    );
    for (const reason of ["person", "network"] as const) {
      mocks.videoLimitReached.mockResolvedValueOnce({ reason, limit: 1 });
      expect(await (await GET(request)).json()).toMatchObject({
        canGenerate: false,
        paused: "limit",
      });
      expect(mocks.reportHeldBack).toHaveBeenLastCalledWith(
        expect.any(Request),
        expect.objectContaining({ reason }),
      );
    }
    expect(mocks.videoLimitReached).toHaveBeenCalledWith(
      { visitorId: visitor, clientIp: "203.0.113.9" },
      { priority: false },
    );
  });

  it("reports a paused narrator as the reason when the budgets have room", async () => {
    mocks.isNarrationAvailable.mockResolvedValue(false);
    expect(await (await get()).json()).toMatchObject({
      canGenerate: false,
      paused: "limit",
    });
    expect(mocks.reportHeldBack).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ reason: "voice" }),
    );
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
