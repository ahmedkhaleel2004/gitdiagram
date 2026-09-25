import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReelsFeed } from "~/components/explainer/reels/reels-feed";
import type * as Reels from "~/features/explainer/reels";
import {
  VIDEO_PAGE_SIZE,
  type VideoCard,
  type VideoPage,
} from "~/features/explainer/catalog-types";

const output = vi.hoisted(() => ({
  context: {
    resume: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    state: "suspended",
  },
  destination: { gain: { value: 1 } },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("~/features/explainer/reels", async (original) => ({
  ...(await original<typeof Reels>()),
  // No stage in these tests: every video reads as missing.
  loadReelVideo: vi.fn(() => Promise.resolve(null)),
  reelOutput: () => output,
}));

const card = (owner: string, repo: string): VideoCard => ({
  owner,
  repo,
  title: `${repo}: explained`,
  opening: "",
  durationSeconds: 60,
  stars: 12_300,
  language: "Rust",
  createdAt: "2026-09-25T00:00:00.000Z",
});

const page = (cards: VideoCard[]): VideoPage => ({
  cards,
  total: cards.length,
  page: 1,
  pageSize: VIDEO_PAGE_SIZE,
  totalPages: 1,
  sort: "stars_desc",
  q: "",
  minStars: 0,
});

beforeEach(() => {
  output.context.resume.mockClear();
  window.history.replaceState(null, "", "/reels");
});

afterEach(cleanup);

describe("ReelsFeed", () => {
  it("shows each video with its repository, stars and links", () => {
    render(
      <ReelsFeed
        initial={page([card("acme", "rocket"), card("acme", "moon")])}
      />,
    );
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getByText("acme/rocket")).toBeTruthy();
    expect(screen.getAllByText("12.3K")).toHaveLength(2);
    expect(
      screen
        .getByRole("link", { name: "Diagram of acme/rocket" })
        .getAttribute("href"),
    ).toBe("/acme/rocket");
    // The address names the video on screen, ready to share.
    expect(window.location.search).toBe("?v=acme%2Frocket");
  });

  it("unlocks the sound on the first tap, then taps pause", () => {
    render(<ReelsFeed initial={page([card("acme", "rocket")])} />);
    fireEvent.click(screen.getByRole("button", { name: /Tap to watch/ }));
    expect(output.context.resume).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Tap to watch/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pause acme/rocket" }));
    expect(
      screen.getByRole("button", { name: "Play acme/rocket" }),
    ).toBeTruthy();
  });

  it("mutes every reel at once", () => {
    render(<ReelsFeed initial={page([card("acme", "rocket")])} />);
    fireEvent.click(screen.getByRole("button", { name: /Tap to watch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(output.destination.gain.value).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(output.destination.gain.value).toBe(1);
  });

  it("says so when there are no videos yet", () => {
    render(<ReelsFeed initial={page([])} />);
    expect(screen.getByText("No videos yet.")).toBeTruthy();
  });
});
