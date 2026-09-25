import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExplainerShare } from "~/components/explainer/explainer-share";
import type * as ExplainerApi from "~/features/explainer/api";
import type { VideoArtifact } from "~/features/explainer/types";

const api = vi.hoisted(() => ({
  streamExplainerRender: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("~/lib/analytics-client", () => ({
  captureAnalyticsEvent: api.capture,
}));
vi.mock("~/features/explainer/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ExplainerApi>()),
  streamExplainerRender: api.streamExplainerRender,
}));

const video = {
  repository: "acme/tiny",
  createdAt: "2026-09-24T00:00:00.000Z",
  meta: { owner: "acme", repo: "tiny" },
  stats: { model: "claude-opus-5-5" },
  timing: { DURATION: 58.4 },
} as unknown as VideoArtifact;

let clicked: string[] = [];

beforeEach(() => {
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.getAttribute("href") ?? "");
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  api.streamExplainerRender.mockReset();
  api.capture.mockReset();
});

describe("ExplainerShare MP4 downloads", () => {
  it("asks for the version on screen, then downloads it", async () => {
    api.streamExplainerRender.mockImplementation(
      async (_o, _r, _f, _v, onEvent: (event: unknown) => void) => {
        onEvent({ status: "rendering", progress: 0.5, step: "rendering" });
        onEvent({ status: "complete" });
      },
    );
    render(<ExplainerShare video={video} />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Download MP4" })),
    );
    expect(api.streamExplainerRender).toHaveBeenCalledWith(
      "acme",
      "tiny",
      "landscape",
      "2026-09-24T00:00:00.000Z",
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(clicked).toEqual([
      "/api/video/file?username=acme&repo=tiny&format=landscape&v=2026-09-24T00%3A00%3A00.000Z",
    ]);
  });

  it("offers a reload when the video was replaced after the page loaded", async () => {
    const { VideoRequestError } = await vi.importActual<typeof ExplainerApi>(
      "~/features/explainer/api",
    );
    api.streamExplainerRender.mockRejectedValue(
      new VideoRequestError("This video was replaced.", 409, true),
    );
    render(<ExplainerShare video={video} />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Vertical MP4" })),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This video was just updated.",
    );
    expect(
      screen.getByRole("button", { name: "Reload to get the new one" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download MP4" })).toBeDisabled();
    expect(clicked).toEqual([]);
  });

  it("stops the render and skips the download once the panel closes", async () => {
    let signal: AbortSignal | undefined;
    let finish: () => void = () => undefined;
    api.streamExplainerRender.mockImplementation(
      (_o, _r, _f, _v, onEvent: (event: unknown) => void, given) => {
        signal = given as AbortSignal;
        return new Promise<void>((resolve) => {
          finish = () => {
            onEvent({ status: "complete" });
            resolve();
          };
        });
      },
    );
    const view = render(<ExplainerShare video={video} />);
    fireEvent.click(screen.getByRole("button", { name: "Download MP4" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Starting the renderer",
    );
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish());
    expect(clicked).toEqual([]);
  });
});

describe("ExplainerShare links", () => {
  it("copies links to the live site, wherever the page is open", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    try {
      render(<ExplainerShare video={video} />);
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Copy link" })),
      );
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "README badge" })),
      );
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "README picture" })),
      );
      expect(writeText.mock.calls).toEqual([
        ["https://gitdiagram.com/acme/tiny/video"],
        [
          "[![Watch a one-minute video tour of tiny](https://gitdiagram.com/video-badge.svg)](https://gitdiagram.com/acme/tiny/video)",
        ],
        [
          "[![acme/tiny, explained in a one-minute video](https://gitdiagram.com/api/video/file?username=acme&repo=tiny&format=poster)](https://gitdiagram.com/acme/tiny/video)",
        ],
      ]);
      expect(api.capture.mock.calls).toEqual(
        ["link", "badge", "picture"].map((method) => [
          "video_shared",
          {
            video_repo: "acme/tiny",
            video_created_at: "2026-09-24T00:00:00.000Z",
            video_model: "claude-opus-5-5",
            video_duration: 58,
            method,
          },
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
