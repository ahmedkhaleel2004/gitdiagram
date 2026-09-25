import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderVideoSegment: vi.fn(),
  readVideoArtifact: vi.fn(),
  storePoster: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => true,
}));
vi.mock("~/server/explainer/render", () => ({
  renderVideoSegment: mocks.renderVideoSegment,
  renderHostStats: async () => ({}),
  segmentRanges: () => [],
  mixSoundtrack: vi.fn(),
  assembleMp4: vi.fn(),
}));
vi.mock("~/server/explainer/store", () => ({
  readVideoArtifact: mocks.readVideoArtifact,
}));
vi.mock("~/server/explainer/posters", () => ({
  storePoster: mocks.storePoster,
}));

import type { SegmentJob } from "~/server/explainer/segments";
import { POST } from "./route";

const createdAt = "2026-09-24T08:06:45.297Z";
const originalEnv = { ...process.env };

function request(overrides: Partial<SegmentJob> = {}, signal?: AbortSignal) {
  const job: SegmentJob = {
    username: "acme",
    repo: "widget",
    v: createdAt,
    format: "landscape",
    from: 0,
    to: 25,
    exp: Date.now() + 60_000,
    ...overrides,
  };
  const signature = createHmac("sha256", "secret")
    .update(
      `video-segment:${[job.username, job.repo, job.v, job.format, job.from, job.to, job.exp].join("|")}`,
    )
    .digest("hex");
  return new Request("https://gitdiagram.com/api/video/render/segment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Video-Segment": signature,
    },
    body: JSON.stringify(job),
    signal,
  });
}

const lines = async (response: Response) =>
  (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; done?: number });

beforeEach(() => {
  process.env = {
    ...originalEnv,
    CACHE_KEY_SECRET: "secret",
    VIDEO_SEGMENT_CONCURRENCY: "1",
  };
  mocks.readVideoArtifact.mockResolvedValue({
    createdAt,
    meta: { owner: "acme", repo: "widget" },
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("POST /api/video/render/segment", () => {
  it("streams progress, always reporting the last frame", async () => {
    mocks.renderVideoSegment.mockImplementation(
      async (params: { onFrame: (done: number) => void }) => {
        for (let done = 1; done <= 25; done++) params.onFrame(done);
        return { mp4: Buffer.from("mp4"), sfx: [] };
      },
    );
    const events = await lines(await POST(request()));
    expect(
      events.filter((e) => e.type === "frames").map((e) => e.done),
    ).toEqual([10, 20, 25]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("turns a render away with a busy 503 while this instance is full", async () => {
    let finish: () => void = () => undefined;
    mocks.renderVideoSegment.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ mp4: Buffer.from("mp4"), sfx: [] });
        }),
    );
    const first = await POST(request());
    const second = await POST(request({ from: 25, to: 50 }));
    expect(second.status).toBe(503);
    expect(second.headers.get("X-Video-Segment-Busy")).toBe("1");
    finish();
    await first.text();
    // The slot is free again once the first render ends.
    mocks.renderVideoSegment.mockResolvedValue({
      mp4: Buffer.from("mp4"),
      sfx: [],
    });
    const third = await POST(request({ from: 25, to: 50 }));
    expect(third.status).toBe(200);
    await third.text();
  });

  it("refuses a stale version without holding a slot", async () => {
    mocks.readVideoArtifact.mockResolvedValue({
      createdAt: "2026-09-25T00:00:00.000Z",
    });
    expect((await POST(request())).status).toBe(409);
    mocks.readVideoArtifact.mockResolvedValue({ createdAt });
    mocks.renderVideoSegment.mockResolvedValue({
      mp4: Buffer.from("mp4"),
      sfx: [],
    });
    const next = await POST(request());
    expect(next.status).toBe(200);
    await next.text();
  });

  it("stops the render when the caller goes away", async () => {
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    mocks.renderVideoSegment.mockImplementation(
      (params: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          seen = params.signal;
          params.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const response = await POST(request({}, caller.signal));
    caller.abort();
    await response.text().catch(() => "");
    expect(seen?.aborted).toBe(true);
  });

  it("remakes a poster as a signed job", async () => {
    mocks.storePoster.mockResolvedValue(true);
    const response = await POST(request({ format: "poster", from: 0, to: 1 }));
    expect(await response.json()).toEqual({ stored: true });
    expect(mocks.renderVideoSegment).not.toHaveBeenCalled();
  });
});
