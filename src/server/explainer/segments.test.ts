import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./render", () => ({
  segmentRanges: () => [
    { from: 0, to: 300 },
    { from: 300, to: 400 },
  ],
  mixSoundtrack: vi.fn(async () => Buffer.from("sound")),
  assembleMp4: vi.fn(async ({ segments }: { segments: Buffer[] }) =>
    Buffer.concat(segments),
  ),
}));

import { createHmac } from "node:crypto";
import type { VideoArtifact } from "~/features/explainer/types";
import { mixSoundtrack } from "./render";
import {
  encodeSegmentEvent,
  renderMp4InSegments,
  verifySegmentJob,
  type RenderProgress,
  type SegmentEvent,
  type SegmentJob,
} from "./segments";

const originalEnv = { ...process.env };
const job = (): SegmentJob => ({
  username: "Owner",
  repo: "Repo",
  v: "2026-09-24T08:06:45.297Z",
  format: "landscape",
  from: 300,
  to: 600,
  exp: Date.now() + 60_000,
});
const sign = (value: SegmentJob) =>
  createHmac("sha256", "secret")
    .update(
      `video-segment:${[value.username.toLowerCase(), value.repo.toLowerCase(), value.v, value.format, value.from, value.to, value.exp].join("|")}`,
    )
    .digest("hex");

beforeEach(() => {
  process.env = { ...originalEnv, CACHE_KEY_SECRET: "secret" };
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("render segment signatures", () => {
  it("accepts the exact job it was signed for", () => {
    const value = job();
    expect(verifySegmentJob(value, sign(value))).toBe(true);
  });

  it("rejects a changed job, an expired one or a bad signature", () => {
    const value = job();
    const signature = sign(value);
    expect(verifySegmentJob({ ...value, to: 900 }, signature)).toBe(false);
    expect(verifySegmentJob({ ...value, format: "vertical" }, signature)).toBe(
      false,
    );
    const expired = { ...value, exp: Date.now() - 1 };
    expect(verifySegmentJob(expired, sign(expired))).toBe(false);
    expect(verifySegmentJob(value, "nope")).toBe(false);
  });
});

describe("rendering in segments", () => {
  const artifact = {
    meta: { owner: "Owner", repo: "Repo" },
    createdAt: "2026-09-24T08:06:45.297Z",
  } as unknown as VideoArtifact;
  const answer = (events: SegmentEvent[]) =>
    new Response(events.map(encodeSegmentEvent).join(""));

  it("reports progress frame by frame and joins the segments in order", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { from } = JSON.parse(String(init.body)) as SegmentJob;
      return from === 0
        ? answer([
            { type: "ready", sfx: [] },
            { type: "frames", done: 150 },
            { type: "done", mp4: Buffer.from("A").toString("base64") },
          ])
        : answer([
            { type: "ready", sfx: [] },
            { type: "frames", done: 100 },
            { type: "done", mp4: Buffer.from("B").toString("base64") },
          ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const progress: RenderProgress[] = [];
    const mp4 = await renderMp4InSegments({
      artifact,
      format: "landscape",
      origin: "https://example.com",
      onProgress: (value) => progress.push(value),
    });
    expect(mp4.toString()).toBe("AB");
    expect(mixSoundtrack).toHaveBeenCalledTimes(1);
    expect(progress[0]).toEqual({ fraction: 0.02, step: "starting" });
    const rendering = progress.filter((value) => value.step === "rendering");
    expect(rendering.length).toBeGreaterThan(0);
    expect(rendering.at(-1)!.fraction).toBeCloseTo(0.03 + 0.9 * (250 / 400));
    expect(progress.at(-1)).toEqual({ fraction: 1, step: "finishing" });
  });

  it("retries a segment that fails part way and fails if the retry does too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer([{ type: "frames", done: 10 }, { type: "error" }]),
      ),
    );
    await expect(
      renderMp4InSegments({
        artifact,
        format: "vertical",
        origin: "https://example.com",
      }),
    ).rejects.toThrow(/failed \(render\)/);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
