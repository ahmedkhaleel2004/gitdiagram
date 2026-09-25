// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  emitLiveEvent: vi.fn(async (_event: Record<string, unknown>) => undefined),
  reportHeldBack: vi.fn(),
  readAdmissionControls: vi.fn(),
  generateExplainerVideo: vi.fn(),
  isNarrationAvailable: vi.fn(),
  readVideoArtifact: vi.fn(),
  reserveVideoSlot: vi.fn(),
  refund: vi.fn(async () => undefined),
  tryVideoLock: vi.fn(),
  releaseLock: vi.fn(async () => undefined),
  tryPaidVideoRun: vi.fn(),
  releaseRun: vi.fn(async () => undefined),
  isVideoAdmin: vi.fn(() => false),
  afterTasks: [] as Array<() => Promise<void>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("~/server/admin/controls", () => ({
  readAdmissionControls: mocks.readAdmissionControls,
}));
vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: mocks.emitLiveEvent,
  requestOrigin: () => ({}),
}));
vi.mock("~/server/explainer/gate-notice", () => ({
  reportHeldBack: mocks.reportHeldBack,
}));
vi.mock("~/server/explainer/cache", () => ({
  purgeVideoResponse: vi.fn(async () => undefined),
  refreshVideoPages: vi.fn(),
}));
vi.mock("~/server/explainer/config", () => ({
  canGenerateVideos: () => true,
  isVideoExplainerEnabled: () => true,
}));
vi.mock("~/server/explainer/generate", () => ({
  generateExplainerVideo: mocks.generateExplainerVideo,
}));
vi.mock("~/server/explainer/limits", () => ({
  generationLockName: (u: string, r: string) => `generate:${u}/${r}`,
  isTrustedVideoCaller: () =>
    process.env.NODE_ENV !== "production" || mocks.isVideoAdmin(),
  isVideoAdmin: mocks.isVideoAdmin,
  limitMessage: (reason: string) => `limit: ${reason}`,
  reserveVideoSlot: mocks.reserveVideoSlot,
  tryPaidVideoRun: mocks.tryPaidVideoRun,
  tryVideoLock: mocks.tryVideoLock,
}));
vi.mock("~/server/explainer/narration", () => ({
  isNarrationAvailable: mocks.isNarrationAvailable,
}));
vi.mock("~/server/explainer/posters", () => ({
  storePoster: vi.fn(async () => true),
}));
vi.mock("~/server/explainer/store", () => ({
  readVideoArtifact: mocks.readVideoArtifact,
}));

import { VideoRefusalError } from "~/server/explainer/director";
import { VideoInputError } from "~/server/explainer/repository";
import { VISITOR_COOKIE } from "~/server/explainer/visitor";
import { POST } from "./route";

const VISITOR = "0b6f3a52-6a1f-4a8e-9a3c-2f0d7c1e5b44";

function request(cookie: string | null = `${VISITOR_COOKIE}=${VISITOR}`) {
  return new Request("https://gitdiagram.com/api/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gitdiagram.com",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ username: "acme", repo: "demo" }),
  });
}

/** Run a request to the end: its SSE events and the after() work. */
async function run(req = request()) {
  const response = await POST(req);
  const text = response.body ? await response.text() : "";
  for (const task of mocks.afterTasks.splice(0)) await task();
  const events = text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as Record<string, unknown>);
  return { response, text, events };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterTasks = [];
  vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.after.mockImplementation((task: () => Promise<void>) => {
    mocks.afterTasks.push(task);
  });
  mocks.isVideoAdmin.mockReturnValue(false);
  mocks.readAdmissionControls.mockResolvedValue({
    videoAudience: "everyone",
    videosPaused: false,
  });
  mocks.isNarrationAvailable.mockResolvedValue(true);
  mocks.readVideoArtifact.mockResolvedValue(null);
  mocks.reserveVideoSlot.mockResolvedValue({ ok: true, refund: mocks.refund });
  mocks.tryVideoLock.mockResolvedValue(mocks.releaseLock);
  mocks.tryPaidVideoRun.mockResolvedValue(mocks.releaseRun);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A run that reads the repository, then (maybe) starts paid work, then fails. */
function failAfter(error: Error, { paid }: { paid: boolean }) {
  mocks.generateExplainerVideo.mockImplementation(
    async (params: {
      onEvent: (event: unknown) => void;
      onPaidWork: () => void;
    }) => {
      params.onEvent({ status: "reading", elapsedMs: 0 });
      if (paid) {
        params.onEvent({ status: "planning", elapsedMs: 1 });
        params.onPaidWork();
      }
      throw error;
    },
  );
}

describe("POST /api/video/generate", () => {
  it("asks a browser without a visitor id to reload", async () => {
    const { response, text } = await run(request(null));
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toMatchObject({
      error: "Reload the page and try again.",
    });
    // The rejection names the browser, so the retry counts as them.
    expect(response.headers.get("set-cookie")).toContain(VISITOR_COOKIE);
    expect(mocks.reserveVideoSlot).not.toHaveBeenCalled();
  });

  it("stops when the live controls cannot be read", async () => {
    mocks.readAdmissionControls.mockRejectedValue(new Error("redis down"));
    const { response } = await run();
    expect(response.status).toBe(503);
    expect(mocks.reserveVideoSlot).not.toHaveBeenCalled();
  });

  it("refunds a failure that happened before any model was paid", async () => {
    failAfter(new Error("GitHub timed out"), { paid: false });
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "error", retryable: true });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRun).toHaveBeenCalledTimes(1);
  });

  it("keeps the slot spent once paid work has started", async () => {
    failAfter(new Error("voice down"), { paid: true });
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "error", retryable: true });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("does not offer a retry after a refusal or for a private repository", async () => {
    failAfter(new VideoRefusalError("declined"), { paid: true });
    expect((await run()).events.at(-1)).toMatchObject({
      status: "error",
      retryable: false,
    });
    failAfter(new VideoInputError("Public repositories only."), {
      paid: false,
    });
    expect((await run()).events.at(-1)).toEqual({
      status: "error",
      error: "Public repositories only.",
      retryable: false,
    });
  });

  it("checks for an existing video again once it holds the lock", async () => {
    mocks.readVideoArtifact
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ repository: "acme/demo" });
    const { response, text } = await run();
    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toMatchObject({
      error: "This repository already has a video.",
    });
    expect(mocks.generateExplainerVideo).not.toHaveBeenCalled();
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("turns people away while too many paid runs are going", async () => {
    mocks.tryPaidVideoRun.mockResolvedValue(null);
    const { response } = await run();
    expect(response.status).toBe(503);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.generateExplainerVideo).not.toHaveBeenCalled();
  });

  it("names the repository on the feed only once it is read as public", async () => {
    failAfter(new VideoInputError("Public repositories only."), {
      paid: false,
    });
    await run();
    const kinds = mocks.emitLiveEvent.mock.calls.map(
      ([event]) => event as { kind: string; repo: string; job?: unknown },
    );
    expect(kinds.map((event) => event.kind)).toEqual(["video.finished"]);
    expect(kinds[0]).toMatchObject({ repo: "a repository" });
    expect(kinds[0]!.job).toBeUndefined();

    mocks.emitLiveEvent.mockClear();
    failAfter(new Error("voice down"), { paid: true });
    await run();
    expect(
      mocks.emitLiveEvent.mock.calls.map(([event]) => [
        (event as { kind: string }).kind,
        (event as { repo: string }).repo,
      ]),
    ).toEqual([
      ["video.started", "acme/demo"],
      ["video.finished", "acme/demo"],
    ]);
  });

  it("passes the run a deadline and completes the stream", async () => {
    mocks.generateExplainerVideo.mockImplementation(
      async (params: { signal: AbortSignal }) => {
        expect(params.signal).toBeInstanceOf(AbortSignal);
        expect(params.signal.aborted).toBe(false);
        return { repository: "acme/demo" };
      },
    );
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "complete" });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
  });
});
