import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExplainerVideo } from "~/components/explainer/explainer-video";
import { setAdminTools } from "~/features/admin/tools";
import type { VideoArtifact } from "~/features/explainer/types";

const api = vi.hoisted(() => ({
  fetchExplainerVideo: vi.fn(),
  streamExplainerVideo: vi.fn(),
  VideoStreamEndedError: class VideoStreamEndedError extends Error {},
  VideoRequestError: class VideoRequestError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly stale = false,
      readonly reason: string | null = null,
    ) {
      super(message);
    }
  },
}));

vi.mock("~/features/explainer/api", () => api);
vi.mock("./explainer-player", () => ({
  ExplainerPlayer: ({ artifact }: { artifact: VideoArtifact }) => (
    <div data-testid="player">{artifact.createdAt}</div>
  ),
}));
vi.mock("./explainer-share", () => ({ ExplainerShare: () => null }));

const video = (createdAt: string) =>
  ({
    createdAt,
    timing: { DURATION: 60 },
    stats: { totalMs: 50_000, plannerCostUsd: null },
    plan: { beats: [{ scene: "a", narration: "" }] },
  }) as unknown as VideoArtifact;

let signedIn = true;

beforeEach(() => {
  signedIn = true;
  api.fetchExplainerVideo.mockResolvedValue({
    video: video("2026-09-24T00:00:00.000Z"),
    canGenerate: false,
    paused: null,
    anyDevice: false,
  });
  api.streamExplainerVideo.mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true, admin: signedIn })),
  );
});

afterEach(() => {
  cleanup();
  act(() => setAdminTools(false));
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function showVideo() {
  render(<ExplainerVideo username="acme" repo="tiny" />);
  await screen.findByTestId("player");
}

describe("ExplainerVideo regenerate", () => {
  it("stays hidden until admin controls are turned on", async () => {
    await showVideo();
    expect(screen.queryByRole("button", { name: "Regenerate video" })).toBe(
      null,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stays hidden for a browser that is not signed in to /admin", async () => {
    signedIn = false;
    act(() => setAdminTools(true));
    await showVideo();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Regenerate video" })).toBe(
      null,
    );
  });

  it("asks first, then regenerates and shows the new video", async () => {
    api.streamExplainerVideo.mockImplementation(
      async (_user, _repo, onEvent: (event: unknown) => void) =>
        onEvent({
          status: "complete",
          artifact: video("2026-09-25T00:00:00.000Z"),
        }),
    );
    act(() => setAdminTools(true));
    await showVideo();

    fireEvent.click(
      await screen.findByRole("button", { name: "Regenerate video" }),
    );
    expect(api.streamExplainerVideo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(api.streamExplainerVideo).toHaveBeenCalledWith(
      "acme",
      "tiny",
      expect.any(Function),
    );
    expect((await screen.findByTestId("player")).textContent).toBe(
      "2026-09-25T00:00:00.000Z",
    );
  });

  it("keeps the current video one click away when regenerating fails", async () => {
    api.streamExplainerVideo.mockImplementation(
      async (_user, _repo, onEvent: (event: unknown) => void) =>
        onEvent({ status: "error", error: "It broke." }),
    );
    act(() => setAdminTools(true));
    await showVideo();

    fireEvent.click(
      await screen.findByRole("button", { name: "Regenerate video" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await screen.findByText("It broke.");
    fireEvent.click(
      screen.getByRole("button", { name: "Keep the current video" }),
    );
    expect((await screen.findByTestId("player")).textContent).toBe(
      "2026-09-24T00:00:00.000Z",
    );
  });
});

const empty = {
  video: null,
  canGenerate: true,
  paused: null,
  anyDevice: true,
  generating: false,
};

describe("ExplainerVideo generation", () => {
  it("keeps making the video while the panel is closed, and shows it on reopening", async () => {
    let send: (event: unknown) => void = () => undefined;
    let finish: () => void = () => undefined;
    api.fetchExplainerVideo.mockResolvedValue(empty);
    api.streamExplainerVideo.mockImplementation(
      (_user, _repo, onEvent: (event: unknown) => void) => {
        send = onEvent;
        return new Promise<void>((resolve) => (finish = resolve));
      },
    );
    const first = render(<ExplainerVideo username="acme" repo="closing" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Make the video" }),
    );
    act(() => send({ status: "planning", elapsedMs: 1, progress: {} }));
    expect(screen.getByText("Writing the script")).toBeTruthy();

    // Closing the panel unmounts it; the run carries on.
    first.unmount();
    act(() => send({ status: "designing", elapsedMs: 2, progress: {} }));
    render(<ExplainerVideo username="acme" repo="closing" />);
    expect(
      await screen.findByText("Designing the scenes and recording the voice"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Make the video" }),
    ).not.toBeInTheDocument();

    act(() => {
      send({ status: "complete", artifact: video("2026-09-25T01:00:00.000Z") });
      finish();
    });
    expect((await screen.findByTestId("player")).textContent).toBe(
      "2026-09-25T01:00:00.000Z",
    );
    expect(api.streamExplainerVideo).toHaveBeenCalledTimes(1);
  });

  it("shows a video someone is making right now and plays it once it lands", async () => {
    vi.useFakeTimers();
    try {
      api.fetchExplainerVideo
        .mockResolvedValueOnce({ ...empty, generating: true })
        .mockResolvedValueOnce({ ...empty, generating: true })
        .mockResolvedValue({
          ...empty,
          video: video("2026-09-25T02:00:00.000Z"),
        });
      render(<ExplainerVideo username="acme" repo="elsewhere" />);
      await act(async () => undefined);
      expect(
        screen.getByText("This video is being made right now"),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Make the video" }),
      ).not.toBeInTheDocument();

      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      expect(
        screen.getByText("This video is being made right now"),
      ).toBeTruthy();
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      expect(screen.getByTestId("player").textContent).toBe(
        "2026-09-25T02:00:00.000Z",
      );
      expect(api.fetchExplainerVideo).toHaveBeenCalledTimes(3);
      expect(api.streamExplainerVideo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers the saved video when the stream closes without a result", async () => {
    api.fetchExplainerVideo.mockResolvedValueOnce(empty).mockResolvedValue({
      ...empty,
      video: video("2026-09-25T03:00:00.000Z"),
    });
    api.streamExplainerVideo.mockRejectedValue(
      new api.VideoStreamEndedError("Could not start video generation."),
    );
    render(<ExplainerVideo username="acme" repo="dropped" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Make the video" }),
    );
    expect((await screen.findByTestId("player")).textContent).toBe(
      "2026-09-25T03:00:00.000Z",
    );
  });

  it("offers another try when the stream closes and nothing was saved", async () => {
    api.fetchExplainerVideo.mockResolvedValue(empty);
    api.streamExplainerVideo.mockRejectedValue(
      new api.VideoStreamEndedError("Could not start video generation."),
    );
    render(<ExplainerVideo username="acme" repo="lost" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Make the video" }),
    );
    const message = "The connection dropped before the video was finished.";
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    // The alert wraps the heading instead of replacing its role.
    expect(screen.getByRole("heading", { name: message })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("ExplainerVideo refusals", () => {
  it("offers no retry once today's videos are made", async () => {
    api.fetchExplainerVideo.mockResolvedValue(empty);
    api.streamExplainerVideo.mockRejectedValue(
      new api.VideoRequestError("Today's free videos have all been made.", 429),
    );
    render(<ExplainerVideo username="acme" repo="budget" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Make the video" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Today's free videos have all been made.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBe(null);
  });

  it("waits for a video someone else is making", async () => {
    api.fetchExplainerVideo.mockResolvedValue(empty);
    api.streamExplainerVideo.mockRejectedValue(
      new api.VideoRequestError(
        "This video is being made right now.",
        409,
        false,
        "generating",
      ),
    );
    render(<ExplainerVideo username="acme" repo="locked" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Make the video" }),
    );
    expect(
      await screen.findByText("This video is being made right now"),
    ).toBeTruthy();
  });
});

describe("ExplainerVideo lookup", () => {
  it("retries a failed lookup without starting a video", async () => {
    api.fetchExplainerVideo
      .mockRejectedValueOnce(new Error("Could not load the explainer video."))
      .mockResolvedValue({
        ...empty,
        video: video("2026-09-24T00:00:00.000Z"),
      });
    render(<ExplainerVideo username="acme" repo="flaky" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the explainer video.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("player");
    expect(api.fetchExplainerVideo).toHaveBeenCalledTimes(2);
    expect(api.streamExplainerVideo).not.toHaveBeenCalled();
  });
});

describe("ExplainerVideo cost", () => {
  const withStats = (stats: Record<string, unknown>) =>
    api.fetchExplainerVideo.mockResolvedValue({
      video: {
        ...video("2026-09-24T00:00:00.000Z"),
        stats: { totalMs: 50_000, model: "claude-opus-5-5", ...stats },
      },
      canGenerate: false,
      paused: null,
      anyDevice: false,
    });

  it("counts the narration in what a video cost", async () => {
    withStats({ plannerCostUsd: 0.4, voiceCostUsd: 0.03 });
    await showVideo();
    expect(screen.getByText(/for \$0\.43$/)).toBeTruthy();
  });

  it("says an older video's cost is the script and design only", async () => {
    withStats({ plannerCostUsd: 0.4 });
    await showVideo();
    expect(screen.getByText(/for \$0\.40 \(script and design\)$/)).toBeTruthy();
  });
});
