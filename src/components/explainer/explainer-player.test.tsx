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
      pause: ReturnType<typeof vi.fn>;
      prewarm: ReturnType<typeof vi.fn>;
      seek: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
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
      return true;
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
  return { posted, fromStage, view, frame };
}

/** A player whose stage and narration have loaded. */
async function readyPlayer() {
  const player = renderPlayer();
  player.fromStage({ type: "stage-ready" });
  player.fromStage({ type: "ready", duration: 20, sfx: [] });
  await act(async () => mixers[0]!.finish());
  return { ...player, mixer: mixers[0]! };
}

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
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

  it("stays paused when a pause lands while a seek is still starting", async () => {
    const { mixer } = await readyPlayer();
    await press("Play");
    let release = (_started: boolean) => {};
    mixer.play.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );
    // Seeking while playing restarts the sound; it is still preparing...
    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), {
      target: { value: "8" },
    });
    // ...when the viewer pauses, so the mixer reports it never started.
    await press("Pause");
    await act(async () => release(false));
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("stays paused when the sound cannot start", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { mixer } = await readyPlayer();
    mixer.play.mockRejectedValueOnce(new Error("not allowed"));
    await press("Play");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(error).toHaveBeenCalled();
  });

  it("moves five seconds per arrow key and reads the time out", async () => {
    const { mixer } = await readyPlayer();
    const slider = screen.getByRole("slider", { name: "Seek" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(mixer.seek).toHaveBeenLastCalledWith(5);
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^0:05 of \d+:\d\d$/);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(mixer.seek).toHaveBeenLastCalledWith(0);
  });

  it("stretches for a hold only once someone presses a side", async () => {
    const { mixer } = await readyPlayer();
    act(() => vi.advanceTimersByTime(2_000));
    expect(mixer.prewarm).not.toHaveBeenCalled();
    await press("Play");
    const side = document.querySelector("[data-side='end']")!;
    fireEvent.pointerDown(side, { isPrimary: true, button: 0 });
    expect(mixer.prewarm).toHaveBeenCalledWith(2);
  });

  it("toggles from the keyboard after a hold released off the player", async () => {
    const { mixer } = await readyPlayer();
    await press("Play");
    const surface = screen.getByRole("button", { name: "Pause explainer" });
    const side = document.querySelector("[data-side='start']")!;
    fireEvent.pointerDown(side, { isPrimary: true, button: 0 });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.pointerLeave(surface);
    // Enter or Space: a click with no detail.
    await act(async () => {
      fireEvent.click(surface, { detail: 0 });
    });
    expect(mixer.pause).toHaveBeenCalled();
  });

  it("does not pause on the click that ends a hold", async () => {
    const { mixer } = await readyPlayer();
    await press("Play");
    const surface = screen.getByRole("button", { name: "Pause explainer" });
    const side = document.querySelector("[data-side='start']")!;
    fireEvent.pointerDown(side, { isPrimary: true, button: 0 });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.pointerUp(surface);
    fireEvent.click(surface, { detail: 1 });
    expect(mixer.pause).not.toHaveBeenCalled();
  });

  it("keeps the rest of the page out of reach in full window", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      await readyPlayer();
      await press("Full screen");
      expect(outside.hasAttribute("inert")).toBe(true);
      expect(
        screen.getByRole("button", { name: "Exit full screen" }),
      ).toBeTruthy();
      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(outside.hasAttribute("inert")).toBe(false);
    } finally {
      outside.remove();
    }
  });

  it("keeps the same stage and sound for the same video", async () => {
    const { view, frame, mixer } = await readyPlayer();
    view.rerender(
      <ExplainerPlayer
        artifact={{ ...artifact, meta: { ...artifact.meta } }}
      />,
    );
    expect(mixer.dispose).not.toHaveBeenCalled();
    expect(view.container.querySelector("iframe")).toBe(frame);
    expect(mixers).toHaveLength(1);
  });
});
