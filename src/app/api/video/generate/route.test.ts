// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Limits from "~/server/explainer/limits";

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
  takeVideoAttempt: vi.fn(),
  takePremiumVideo: vi.fn(),
  refundPremium: vi.fn(async () => undefined),
  tryVideoLock: vi.fn(),
  releaseLock: vi.fn(async () => undefined),
  tryPaidVideoRun: vi.fn(),
  releaseRun: vi.fn(async () => undefined),
  verifyAdminRequest: vi.fn(async () => false),
  refreshVideoPages: vi.fn(),
  remakePosterRemotely: vi.fn(
    async (
      _artifact: unknown,
      _origin: string,
      _options: { timeoutMs: number },
    ) => true,
  ),
  afterTasks: [] as Array<() => Promise<void>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("~/server/admin/controls", () => ({
  readAdmissionControls: mocks.readAdmissionControls,
  readControls: mocks.readAdmissionControls,
}));
// Who the operator is: the real limits module decides who is trusted from it.
vi.mock("~/server/admin/operator", () => ({
  isOperatorToken: () => false,
  verifyAdminRequest: mocks.verifyAdminRequest,
}));
vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: mocks.emitLiveEvent,
  requestOrigin: () => ({}),
}));
vi.mock("~/server/explainer/gate-notice", () => ({
  reportHeldBack: mocks.reportHeldBack,
}));
vi.mock("~/server/explainer/cache", () => ({
  refreshVideoPages: mocks.refreshVideoPages,
}));
vi.mock("~/server/explainer/config", () => ({
  canGenerateVideos: () => true,
  isVideoExplainerEnabled: () => true,
}));
vi.mock("~/server/explainer/generate", () => ({
  generateExplainerVideo: mocks.generateExplainerVideo,
}));
vi.mock("~/server/explainer/limits", async (importOriginal) => ({
  ...(await importOriginal<typeof Limits>()),
  reserveVideoSlot: mocks.reserveVideoSlot,
  takePremiumVideo: mocks.takePremiumVideo,
  takeVideoAttempt: mocks.takeVideoAttempt,
  tryPaidVideoRun: mocks.tryPaidVideoRun,
  tryVideoLock: mocks.tryVideoLock,
}));
vi.mock("~/server/explainer/narration", () => ({
  isNarrationAvailable: mocks.isNarrationAvailable,
}));
vi.mock("~/server/explainer/planner", () => ({
  choosePlanner: async (params: {
    takePremium: () => Promise<{ refund: () => Promise<void> } | null>;
  }) => {
    const taken = await params.takePremium();
    return { planner: {}, refund: taken?.refund };
  },
}));
vi.mock("~/server/explainer/segments", () => ({
  remakePosterRemotely: mocks.remakePosterRemotely,
}));
vi.mock("~/server/explainer/store", () => ({
  readVideoArtifact: mocks.readVideoArtifact,
}));

import { VideoRefusalError } from "~/server/explainer/director";
import { pausedMessage } from "~/server/explainer/limits";
import { VideoInputError } from "~/server/explainer/repository";
import { VISITOR_COOKIE } from "~/server/explainer/visitor";
import { VoiceUnavailableError } from "~/server/explainer/voice";
import { POST } from "./route";

const VISITOR = "0b6f3a52-6a1f-4a8e-9a3c-2f0d7c1e5b44";

function request(
  cookie: string | null = `${VISITOR_COOKIE}=${VISITOR}`,
  headers: Record<string, string> = {},
) {
  return new Request("https://gitdiagram.com/api/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gitdiagram.com",
      "x-forwarded-for": "203.0.113.9",
      ...(cookie ? { cookie } : {}),
      ...headers,
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
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.after.mockImplementation((task: () => Promise<void>) => {
    mocks.afterTasks.push(task);
  });
  mocks.verifyAdminRequest.mockResolvedValue(false);
  mocks.readAdmissionControls.mockResolvedValue({
    videoAudience: "everyone",
    videosPaused: false,
  });
  mocks.isNarrationAvailable.mockResolvedValue(true);
  mocks.readVideoArtifact.mockResolvedValue(null);
  mocks.reserveVideoSlot.mockResolvedValue({ ok: true, refund: mocks.refund });
  mocks.takeVideoAttempt.mockResolvedValue({ ok: true, retryAfterSeconds: 60 });
  mocks.takePremiumVideo.mockResolvedValue({ refund: mocks.refundPremium });
  mocks.tryVideoLock.mockResolvedValue(mocks.releaseLock);
  mocks.tryPaidVideoRun.mockResolvedValue(mocks.releaseRun);
  mocks.remakePosterRemotely.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

type RunParams = {
  onEvent: (event: unknown) => void;
  onPaidWork: () => Promise<void>;
  choosePlanner: (repository: { stars: number }) => Promise<unknown>;
};

/** A run that reads the repository, then (maybe) starts paid work, then fails. */
function failAfter(error: Error, { paid }: { paid: boolean }) {
  mocks.generateExplainerVideo.mockImplementation(async (params: RunParams) => {
    params.onEvent({ status: "reading", elapsedMs: 0 });
    await params.choosePlanner({ stars: 1 });
    if (paid) {
      params.onEvent({ status: "planning", elapsedMs: 1 });
      await params.onPaidWork();
    }
    throw error;
  });
}

/** A run that makes its video. */
function succeed() {
  mocks.generateExplainerVideo.mockImplementation(async (params: RunParams) => {
    params.onEvent({ status: "planning", elapsedMs: 1 });
    await params.onPaidWork();
    return { repository: "acme/demo", createdAt: "2026-09-25T00:00:00.000Z" };
  });
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

  it("says new videos are paused while the operator has paused them", async () => {
    mocks.readAdmissionControls.mockResolvedValue({
      videoAudience: "everyone",
      videosPaused: true,
    });
    const { response, text } = await run();
    expect(response.status).toBe(503);
    expect(JSON.parse(text).error).toBe(pausedMessage("paused"));
    expect(mocks.reportHeldBack).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ reason: "paused", step: "start" }),
    );
    expect(mocks.reserveVideoSlot).not.toHaveBeenCalled();
  });

  it("says the pause is short while the narrator's balance is out", async () => {
    mocks.isNarrationAvailable.mockResolvedValue(false);
    const { response, text } = await run();
    expect(response.status).toBe(503);
    expect(JSON.parse(text).error).toBe(pausedMessage("voice"));
    expect(mocks.reserveVideoSlot).not.toHaveBeenCalled();
  });

  it("holds back visitors the audience rule leaves out", async () => {
    mocks.readAdmissionControls.mockResolvedValue({
      videoAudience: "priority",
      videosPaused: false,
    });
    const { response, text } = await run();
    expect(response.status).toBe(403);
    expect(JSON.parse(text).error).toMatch(/early access/);
    expect(mocks.reportHeldBack).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ reason: "place" }),
    );
    expect(mocks.reserveVideoSlot).not.toHaveBeenCalled();
  });

  it("turns away a visitor asking for a video that already exists, before reserving", async () => {
    mocks.readVideoArtifact.mockResolvedValue({ repository: "acme/demo" });
    const { response, text } = await run();
    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toMatchObject({
      error: "This repository already has a video.",
    });
    expect(mocks.reserveVideoSlot).not.toHaveBeenCalled();
    expect(mocks.tryVideoLock).not.toHaveBeenCalled();
  });

  it("answers in JSON when storage cannot be read", async () => {
    mocks.readVideoArtifact.mockRejectedValue(new Error("R2 down"));
    const { response, text } = await run();
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ ok: false });
    expect(mocks.reserveVideoSlot).not.toHaveBeenCalled();
  });

  it("lets the operator replace an existing video", async () => {
    mocks.verifyAdminRequest.mockResolvedValue(true);
    mocks.readVideoArtifact.mockResolvedValue({ repository: "acme/demo" });
    succeed();
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "complete" });
    expect(mocks.reserveVideoSlot).not.toHaveBeenCalled();
    expect(mocks.takeVideoAttempt).not.toHaveBeenCalled();
    expect(mocks.tryPaidVideoRun).toHaveBeenCalledWith({
      operator: true,
      ttlMs: expect.any(Number),
    });
  });

  it("refunds the reservation when the repository's lock is already held", async () => {
    mocks.tryVideoLock.mockResolvedValue(null);
    const { response } = await run();
    expect(response.status).toBe(409);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.takeVideoAttempt).not.toHaveBeenCalled();
    expect(mocks.generateExplainerVideo).not.toHaveBeenCalled();
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

  it("limits new videos per connection before reading GitHub, and never refunds that", async () => {
    mocks.takeVideoAttempt.mockResolvedValue({
      ok: false,
      retryAfterSeconds: 600,
    });
    const { response, text } = await run();
    expect(response.status).toBe(429);
    expect(JSON.parse(text).error).toContain("about 10 minutes");
    expect(mocks.takeVideoAttempt).toHaveBeenCalledWith("203.0.113.9");
    // The daily place goes back; the attempt stays counted.
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.generateExplainerVideo).not.toHaveBeenCalled();
  });

  it("refunds a failure that happened before any model was paid", async () => {
    failAfter(new Error("GitHub timed out"), { paid: false });
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "error", retryable: true });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refundPremium).toHaveBeenCalledTimes(1);
    expect(mocks.takePremiumVideo).toHaveBeenCalledWith({
      visitorId: VISITOR,
      clientIp: "203.0.113.9",
    });
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
    // No model was called, so no paid-run place was ever taken.
    expect(mocks.tryPaidVideoRun).not.toHaveBeenCalled();
    expect(mocks.takeVideoAttempt).toHaveBeenCalledTimes(1);
  });

  it("keeps the slot spent once paid work has started, and offers no retry", async () => {
    failAfter(new Error("model down"), { paid: true });
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "error", retryable: false });
    expect(String(events.at(-1)!.error)).toMatch(/counted toward today/);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.refundPremium).not.toHaveBeenCalled();
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRun).toHaveBeenCalledTimes(1);
  });

  it("offers the operator a retry after a paid failure", async () => {
    mocks.verifyAdminRequest.mockResolvedValue(true);
    failAfter(new Error("model down"), { paid: true });
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "error", retryable: true });
  });

  it("refunds the visitor when the narrator runs out of credit mid-run", async () => {
    failAfter(new VoiceUnavailableError("The voice balance has run out."), {
      paid: true,
    });
    const { events } = await run();
    expect(events.at(-1)).toEqual({
      status: "error",
      error:
        "The narrator is unavailable right now. Try again in a few minutes.",
      retryable: true,
    });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refundPremium).toHaveBeenCalledTimes(1);
  });

  it("takes a paid-run place only when paid work starts, and turns the run away when they are full", async () => {
    mocks.tryPaidVideoRun.mockResolvedValue(null);
    failAfter(new Error("unreachable"), { paid: true });
    const { response, events } = await run();
    expect(response.status).toBe(200);
    expect(events.at(-1)).toEqual({
      status: "error",
      error:
        "Lots of videos are being made right now. Try again in a few minutes.",
      retryable: true,
    });
    expect(mocks.reportHeldBack).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ reason: "busy" }),
    );
    // Nothing was paid for, so the visitor keeps their video for today.
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refundPremium).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRun).not.toHaveBeenCalled();
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

  it("passes the run a deadline, completes the stream, then makes the poster remotely", async () => {
    mocks.generateExplainerVideo.mockImplementation(
      async (params: RunParams & { signal: AbortSignal }) => {
        expect(params.signal).toBeInstanceOf(AbortSignal);
        expect(params.signal.aborted).toBe(false);
        await params.onPaidWork();
        return { repository: "acme/demo" };
      },
    );
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "complete" });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRun).toHaveBeenCalledTimes(1);
    // The lock and paid-run place are released before the poster is made.
    expect(mocks.releaseLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remakePosterRemotely.mock.invocationCallOrder[0]!,
    );
    expect(mocks.remakePosterRemotely).toHaveBeenCalledWith(
      { repository: "acme/demo" },
      "https://gitdiagram.com",
      { timeoutMs: expect.any(Number) },
    );
    const { timeoutMs } = mocks.remakePosterRemotely.mock.calls[0]![2];
    expect(timeoutMs).toBeLessThanOrEqual(285_000);
    // Once for the new video, once more for its poster.
    expect(mocks.refreshVideoPages).toHaveBeenCalledTimes(2);
  });

  it("skips the poster when too little of the function's time is left", async () => {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    mocks.generateExplainerVideo.mockImplementation(async () => {
      vi.setSystemTime(start + 270_000);
      return { repository: "acme/demo" };
    });
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({ status: "complete" });
    expect(mocks.remakePosterRemotely).not.toHaveBeenCalled();
    // The pages still point at the new video.
    expect(mocks.refreshVideoPages).toHaveBeenCalledTimes(1);
  });
});
