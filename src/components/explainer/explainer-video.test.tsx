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
      expect.any(AbortSignal),
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
