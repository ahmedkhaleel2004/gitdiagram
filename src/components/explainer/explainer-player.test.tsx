import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExplainerPlayer } from "~/components/explainer/explainer-player";
import fixture from "~/features/explainer/__fixtures__/gitdiagram-video.json";
import type { VideoArtifact } from "~/features/explainer/types";

const mixers = vi.hoisted(
  () =>
    [] as Array<{
      onInterrupted: (() => void) | null;
      isPlaying: boolean;
      finish: () => void;
      play: ReturnType<typeof vi.fn>;
    }>,
);

vi.mock("~/features/explainer/audio-mixer", () => ({
  ExplainerAudio: class {
    onInterrupted: (() => void) | null = null;
    isPlaying = false;
    finish = () => {};
    constructor() {
      mixers.push(this);
    }
    load() {
      return new Promise<void>((resolve) => (this.finish = resolve));
    }
    play = vi.fn(async () => {
      this.isPlaying = true;
    });
    pause = vi.fn(() => {
      this.isPlaying = false;
      return 0;
    });
    setRate = vi.fn(async () => {});
    prewarm = vi.fn();
    seek = vi.fn();
    currentTime = () => 0;
    dispose = vi.fn();
  },
}));

const artifact = fixture as unknown as VideoArtifact;

function renderPlayer() {
  const view = render(<ExplainerPlayer artifact={artifact} />);
  const frame = view.container.querySelector("iframe")!;
  const stage = frame.contentWindow!;
  const posted = vi.spyOn(stage, "postMessage");
  const fromStage = (data: unknown) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          origin: window.location.origin,
          source: stage,
        }),
      );
    });
  return { posted, fromStage };
}

beforeEach(() => {
  mixers.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ExplainerPlayer", () => {
  it("works with storage blocked and keeps the stage's captions in step", () => {
    const blocked = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    const { posted, fromStage } = renderPlayer();
    fromStage({ type: "stage-ready" });
    // Captions off while the stage is still building...
    fireEvent.click(screen.getByRole("button", { name: "Hide captions" }));
    expect(screen.getByRole("button", { name: "Show captions" })).toBeTruthy();
    // ...reach the stage once it is ready.
    posted.mockClear();
    fromStage({ type: "ready", duration: 20, sfx: [] });
    expect(posted).toHaveBeenCalledWith(
      { type: "captions", on: false },
      window.location.origin,
    );
  });

  it("clears the timeout message when the narration arrives late", async () => {
    const { fromStage } = renderPlayer();
    fromStage({ type: "stage-ready" });
    fromStage({ type: "ready", duration: 20, sfx: [] });
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("alert").textContent).toContain(
      "The narration took too long to load.",
    );
    await act(async () => mixers[0]!.finish());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Play" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows the video paused when the system stops the sound", async () => {
    const { fromStage } = renderPlayer();
    fromStage({ type: "stage-ready" });
    fromStage({ type: "ready", duration: 20, sfx: [] });
    await act(async () => mixers[0]!.finish());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    act(() => {
      mixers[0]!.isPlaying = false;
      mixers[0]!.onInterrupted?.();
    });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });
});
