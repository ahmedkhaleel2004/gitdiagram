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
  RENDER_DEADLINE_MS,
  renderMp4InSegments,
  SEGMENT_BUSY_HEADER,
  SegmentFailure,
  verifySegmentJob,
  withSegmentRetries,
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

/** Run a promise to the end, moving the fake clock through its backoffs. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const result = promise.finally(() => {
    done = true;
  });
  result.catch(() => undefined);
  while (!done) await vi.advanceTimersByTimeAsync(1_000);
  return result;
}

beforeEach(() => {
  process.env = { ...originalEnv, CACHE_KEY_SECRET: "secret" };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
    expect(verifySegmentJob({ ...value, format: "poster" }, signature)).toBe(
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
  const done = (body: string): SegmentEvent => ({
    type: "done",
    mp4: Buffer.from(body).toString("base64"),
  });
  /** A segment still rendering: it only ends when its request is aborted. */
  const rendering = (signal: AbortSignal) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              encodeSegmentEvent({ type: "ready", sfx: [] }),
            ),
          );
          signal.addEventListener("abort", () =>
            controller.error(signal.reason),
          );
        },
      }),
    );
  const render = (onProgress?: (value: RenderProgress) => void) =>
    renderMp4InSegments({
      artifact,
      format: "landscape",
      origin: "https://example.com",
      onProgress,
    });
  const bodyOf = (init: RequestInit) =>
    JSON.parse(String(init.body)) as SegmentJob;

  it("reports progress frame by frame and joins the segments in order", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      bodyOf(init).from === 0
        ? answer([
            { type: "ready", sfx: [] },
            { type: "frames", done: 150 },
            done("A"),
          ])
        : answer([
            { type: "ready", sfx: [] },
            { type: "frames", done: 90 },
            done("B"),
          ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const progress: RenderProgress[] = [];
    const mp4 = await settle(render((value) => progress.push(value)));
    expect(mp4.toString()).toBe("AB");
    expect(mixSoundtrack).toHaveBeenCalledTimes(1);
    expect(progress[0]).toEqual({ fraction: 0.02, step: "starting" });
    // Frames the route never reported still count once a segment is done.
    const rendering = progress.filter((value) => value.step === "rendering");
    expect(rendering.at(-1)!.fraction).toBeCloseTo(0.93);
    expect(progress.at(-1)).toEqual({ fraction: 1, step: "finishing" });
    // Every attempt's signature outlives the render's deadline.
    const signed = bodyOf(fetchMock.mock.calls[0]![1]);
    expect(signed.exp).toBeGreaterThanOrEqual(Date.now() + RENDER_DEADLINE_MS);
  });

  it("never moves the progress bar backwards when a segment is retried", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (bodyOf(init).from !== 0)
          return answer([{ type: "ready", sfx: [] }, done("B")]);
        attempts++;
        return attempts === 1
          ? answer([{ type: "frames", done: 200 }, { type: "error" }])
          : answer([
              { type: "ready", sfx: [] },
              { type: "frames", done: 50 },
              { type: "frames", done: 250 },
              done("A"),
            ]);
      }),
    );
    const progress: number[] = [];
    await settle(render((value) => progress.push(value.fraction)));
    expect(attempts).toBe(2);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("gives up after three real failures and stops the other segments", async () => {
    const siblings: AbortSignal[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (bodyOf(init).from === 0)
        return answer([{ type: "frames", done: 10 }, { type: "error" }]);
      siblings.push(init.signal!);
      return rendering(init.signal!);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(settle(render())).rejects.toThrow(/failed \(render\)/);
    const failing = fetchMock.mock.calls.filter(
      ([, init]) => bodyOf(init).from === 0,
    );
    expect(failing).toHaveLength(3);
    expect(siblings.length).toBeGreaterThan(0);
    expect(siblings.every((signal) => signal.aborted)).toBe(true);
  });

  it("does not retry a job the segment route refuses", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      bodyOf(init).from === 0
        ? new Response("{}", { status: 409 })
        : rendering(init.signal!),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(settle(render())).rejects.toThrow(/failed \(409\)/);
    expect(
      fetchMock.mock.calls.filter(([, init]) => bodyOf(init).from === 0),
    ).toHaveLength(1);
  });

  it("waits out busy render instances without spending retries", async () => {
    let busy = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (bodyOf(init).from === 0 && busy < 5) {
          busy++;
          return new Response("{}", {
            status: 503,
            headers: { [SEGMENT_BUSY_HEADER]: "1" },
          });
        }
        return answer([{ type: "ready", sfx: [] }, done("X")]);
      }),
    );
    await expect(settle(render())).resolves.toEqual(Buffer.from("XX"));
    expect(busy).toBe(5);
  });
});

describe("segment retries", () => {
  it("stop when the deadline leaves no room for another attempt", async () => {
    const attempt = vi.fn(async () => {
      throw new SegmentFailure("flaky", "retry");
    });
    await expect(
      settle(
        withSegmentRetries(attempt, {
          deadline: Date.now() + 5_000,
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow(/ran out of time/);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("retry a network error and a 5xx, but not a final failure", async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new SegmentFailure("502", "retry"))
      .mockResolvedValueOnce("ok");
    await expect(
      settle(
        withSegmentRetries(attempt, {
          deadline: Date.now() + 600_000,
          signal: new AbortController().signal,
        }),
      ),
    ).resolves.toBe("ok");
    const final = vi.fn(async () => {
      throw new SegmentFailure("403", "final");
    });
    await expect(
      settle(
        withSegmentRetries(final, {
          deadline: Date.now() + 600_000,
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow("403");
    expect(final).toHaveBeenCalledTimes(1);
  });
});
