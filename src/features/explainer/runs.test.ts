import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ExplainerApi from "./api";
import { startVideoRun, useVideoRun } from "./runs";
import { useStoredVideoModel } from "./stored-video";
import type { VideoArtifact } from "./types";

const api = vi.hoisted(() => ({
  fetchExplainerVideo: vi.fn(),
  streamExplainerVideo: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof ExplainerApi>()),
  fetchExplainerVideo: api.fetchExplainerVideo,
  streamExplainerVideo: api.streamExplainerVideo,
}));

const { VideoRequestError, VideoStreamEndedError } =
  await vi.importActual<typeof ExplainerApi>("./api");

const video = (createdAt: string, model = "claude-opus-5-5") =>
  ({ createdAt, stats: { model } }) as unknown as VideoArtifact;

const state = (extra: Partial<ExplainerApi.ExplainerVideoState> = {}) => ({
  video: null,
  canGenerate: true,
  paused: null,
  anyDevice: true,
  generating: false,
  ...extra,
});

// Each test uses its own repository: runs live in module state.
let count = 0;
let repo = "";

beforeEach(() => {
  repo = `repo-${++count}`;
  api.fetchExplainerVideo.mockResolvedValue(state());
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Start a run while a component shows it, then wait for it to settle. */
async function run(rejection: unknown) {
  api.streamExplainerVideo.mockRejectedValue(rejection);
  const view = renderHook(() => useVideoRun("acme", repo));
  act(() => startVideoRun("acme", repo));
  await waitFor(() => expect(view.result.current?.kind).not.toBe("generating"));
  return view;
}

describe("refusals before any stream", () => {
  it("watches for a video another run is making", async () => {
    const view = await run(
      new VideoRequestError(
        "This video is being made right now.",
        409,
        false,
        "generating",
      ),
    );
    expect(view.result.current).toEqual({ kind: "waiting" });
    expect(api.fetchExplainerVideo).not.toHaveBeenCalled();
  });

  it("shows the video that already exists", async () => {
    const stored = video("2026-09-24T00:00:00.000Z");
    api.fetchExplainerVideo.mockResolvedValue(state({ video: stored }));
    const view = await run(
      new VideoRequestError("This repository already has a video.", 409),
    );
    expect(view.result.current).toEqual({ kind: "ready", video: stored });
  });

  it("asks which conflict it was when the server does not say", async () => {
    api.fetchExplainerVideo.mockResolvedValue(state({ generating: true }));
    const view = await run(
      new VideoRequestError("This video is being made right now.", 409),
    );
    expect(view.result.current).toEqual({ kind: "waiting" });
  });

  it.each([
    [403, "Making new videos is in early access."],
    [429, "You have made today's videos."],
    [503, "Lots of videos are being made right now."],
  ])("offers no retry for a %i", async (status, message) => {
    const view = await run(new VideoRequestError(message, status));
    expect(view.result.current).toMatchObject({
      kind: "error",
      message,
      canGenerate: false,
    });
  });

  it("offers a retry when the page only has to name the browser", async () => {
    const view = await run(
      new VideoRequestError("Reload the page and try again.", 400),
    );
    expect(view.result.current).toMatchObject({
      kind: "error",
      canGenerate: true,
    });
  });
});

describe("a lost connection", () => {
  it("keeps watching a run the server is still making", async () => {
    api.fetchExplainerVideo.mockResolvedValue(state({ generating: true }));
    const view = await run(new TypeError("network error"));
    expect(view.result.current).toEqual({ kind: "waiting" });
  });

  it("shows the video the server saved meanwhile", async () => {
    const saved = video("2026-09-25T00:00:00.000Z");
    api.fetchExplainerVideo.mockResolvedValue(state({ video: saved }));
    const view = await run(new TypeError("Load failed"));
    expect(view.result.current).toEqual({ kind: "ready", video: saved });
  });

  it("keeps watching while the lookup fails too", async () => {
    api.fetchExplainerVideo.mockRejectedValue(new TypeError("offline"));
    const view = await run(new TypeError("network error"));
    expect(view.result.current).toEqual({ kind: "waiting" });
  });

  it("offers another try when nothing was saved or is being made", async () => {
    const view = await run(new VideoStreamEndedError("closed"));
    expect(view.result.current).toMatchObject({
      kind: "error",
      message: "The connection dropped before the video was finished.",
      canGenerate: true,
    });
  });
});

describe("finished runs", () => {
  it("are not kept when they finish with nothing showing them", async () => {
    let finish: () => void = () => undefined;
    const made = video("2026-09-25T01:00:00.000Z");
    api.streamExplainerVideo.mockImplementation(
      (_user, _repo, onEvent: (event: unknown) => void) =>
        new Promise<void>((resolve) => {
          finish = () => {
            onEvent({ status: "complete", artifact: made });
            resolve();
          };
        }),
    );
    const panel = renderHook(() => useVideoRun("acme", repo));
    act(() => startVideoRun("acme", repo));
    panel.unmount();
    // A live run outlives its panel.
    const reopened = renderHook(() => useVideoRun("acme", repo));
    expect(reopened.result.current?.kind).toBe("generating");
    reopened.unmount();

    await act(async () => finish());
    expect(renderHook(() => useVideoRun("acme", repo)).result.current).toBe(
      undefined,
    );
  });

  it("are let go once the last component showing them closes", async () => {
    const made = video("2026-09-25T02:00:00.000Z");
    api.streamExplainerVideo.mockImplementation(
      async (_user, _repo, onEvent: (event: unknown) => void) =>
        onEvent({ status: "complete", artifact: made }),
    );
    const panel = renderHook(() => useVideoRun("acme", repo));
    const info = renderHook(() => useVideoRun("acme", repo));
    await act(async () => startVideoRun("acme", repo));
    expect(panel.result.current).toEqual({ kind: "ready", video: made });

    panel.unmount();
    await act(async () => undefined);
    expect(info.result.current).toEqual({ kind: "ready", video: made });
    info.unmount();
    await act(async () => undefined);
    expect(renderHook(() => useVideoRun("acme", repo)).result.current).toBe(
      undefined,
    );
  });
});

describe("the stored video's model", () => {
  it("is updated when a run finishes, even after its panel closed", async () => {
    let finish: () => void = () => undefined;
    api.streamExplainerVideo.mockImplementation(
      (_user, _repo, onEvent: (event: unknown) => void) =>
        new Promise<void>((resolve) => {
          finish = () => {
            onEvent({
              status: "complete",
              artifact: video("2026-09-25T03:00:00.000Z", "gpt-6-sol"),
            });
            resolve();
          };
        }),
    );
    const info = renderHook(() => useStoredVideoModel("acme", repo));
    await waitFor(() => expect(info.result.current).toBe(null));
    const panel = renderHook(() => useVideoRun("acme", repo));
    act(() => startVideoRun("acme", repo));
    panel.unmount();
    await act(async () => finish());
    expect(info.result.current).toBe("gpt-6-sol");
  });

  it("looks again on the next mount when there was no video", async () => {
    const first = renderHook(() => useStoredVideoModel("acme", repo));
    await waitFor(() => expect(first.result.current).toBe(null));
    first.unmount();
    api.fetchExplainerVideo.mockResolvedValue(
      state({ video: video("2026-09-25T04:00:00.000Z", "claude-opus-5-5") }),
    );
    const second = renderHook(() => useStoredVideoModel("acme", repo));
    await waitFor(() => expect(second.result.current).toBe("claude-opus-5-5"));
    expect(api.fetchExplainerVideo).toHaveBeenCalledTimes(2);
  });

  it("shares one lookup between everything asking at once", async () => {
    api.fetchExplainerVideo.mockResolvedValue(
      state({ video: video("2026-09-25T05:00:00.000Z") }),
    );
    const a = renderHook(() => useStoredVideoModel("acme", repo));
    const b = renderHook(() => useStoredVideoModel("acme", repo));
    await waitFor(() => expect(a.result.current).toBe("claude-opus-5-5"));
    expect(b.result.current).toBe("claude-opus-5-5");
    expect(api.fetchExplainerVideo).toHaveBeenCalledTimes(1);
  });
});
