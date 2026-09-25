import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readVideoArtifact: vi.fn(),
  hasRender: vi.fn(),
  writeRender: vi.fn(),
  renderMp4InSegments: vi.fn(),
  remakePosterRemotely: vi.fn(),
  reserveRenderSlot: vi.fn(),
  tryVideoLock: vi.fn(),
  isTrustedVideoCaller: vi.fn(),
  refreshVideoPages: vi.fn(),
  refund: vi.fn(),
  release: vi.fn(),
  after: [] as Array<() => unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (task: () => unknown) => mocks.after.push(task),
}));
vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: async () => undefined,
}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => true,
}));
vi.mock("~/server/explainer/cache", () => ({
  refreshVideoPages: mocks.refreshVideoPages,
}));
vi.mock("~/server/explainer/limits", () => ({
  isTrustedVideoCaller: mocks.isTrustedVideoCaller,
  reserveRenderSlot: mocks.reserveRenderSlot,
  renderLimitMessage: () => "limit",
  tryVideoLock: mocks.tryVideoLock,
}));
vi.mock("~/server/explainer/segments", () => ({
  renderMp4InSegments: mocks.renderMp4InSegments,
  remakePosterRemotely: mocks.remakePosterRemotely,
}));
vi.mock("~/server/explainer/store", () => ({
  hasRender: mocks.hasRender,
  readVideoArtifact: mocks.readVideoArtifact,
  writeRender: mocks.writeRender,
}));

import { POST } from "./route";

const createdAt = "2026-09-24T08:06:45.297Z";
const artifact = {
  createdAt,
  repository: "acme/widget",
  meta: { owner: "acme", repo: "widget" },
};
const originalEnv = { ...process.env };

function request(body: Record<string, unknown>) {
  return new Request("https://gitdiagram.com/api/video/render", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gitdiagram.com",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ username: "acme", repo: "widget", ...body }),
  });
}

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: "production" };
  mocks.after.length = 0;
  mocks.readVideoArtifact.mockResolvedValue(artifact);
  mocks.hasRender.mockResolvedValue(false);
  mocks.isTrustedVideoCaller.mockReturnValue(false);
  mocks.tryVideoLock.mockResolvedValue(mocks.release);
  mocks.reserveRenderSlot.mockResolvedValue({ ok: true, refund: mocks.refund });
  mocks.renderMp4InSegments.mockResolvedValue(Buffer.from("mp4"));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("POST /api/video/render", () => {
  it("tells a viewer with an older version open to reload, spending nothing", async () => {
    const response = await POST(
      request({ format: "landscape", v: "2026-09-01T00:00:00.000Z" }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ stale: true });
    expect(mocks.reserveRenderSlot).not.toHaveBeenCalled();
    expect(mocks.tryVideoLock).not.toHaveBeenCalled();
  });

  it("renders and stores the MP4 of the version the viewer has open", async () => {
    const response = await POST(request({ format: "landscape", v: createdAt }));
    expect(await response.text()).toContain('"status":"complete"');
    expect(mocks.writeRender).toHaveBeenCalledWith(
      artifact,
      "landscape.mp4",
      Buffer.from("mp4"),
    );
    expect(mocks.release).toHaveBeenCalled();
  });

  it("serves an MP4 another render stored while it waited for the lock", async () => {
    mocks.hasRender.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const response = await POST(request({ format: "vertical", v: createdAt }));
    expect(await response.text()).toContain('"status":"complete"');
    expect(mocks.reserveRenderSlot).not.toHaveBeenCalled();
    expect(mocks.renderMp4InSegments).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });

  it("drops an MP4 whose video was regenerated while it rendered", async () => {
    mocks.readVideoArtifact
      .mockResolvedValueOnce(artifact)
      .mockResolvedValueOnce({
        ...artifact,
        createdAt: "2026-09-25T00:00:00.000Z",
      });
    const response = await POST(request({ format: "landscape", v: createdAt }));
    expect(await response.text()).toContain("Reload the page");
    expect(mocks.writeRender).not.toHaveBeenCalled();
    expect(mocks.refund).toHaveBeenCalled();
  });

  it("remakes a poster on a render instance and refreshes its pages", async () => {
    mocks.isTrustedVideoCaller.mockReturnValue(true);
    mocks.remakePosterRemotely.mockResolvedValue(true);
    const response = await POST(request({ format: "poster" }));
    expect(await response.text()).toContain('"status":"complete"');
    expect(mocks.refreshVideoPages).toHaveBeenCalledWith("acme", "widget");
  });
});
