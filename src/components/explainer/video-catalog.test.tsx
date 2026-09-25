import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VIDEO_PAGE_SIZE,
  VideoCatalog,
} from "~/components/explainer/video-catalog";
import type { VideoCard } from "~/server/explainer/catalog";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

function card(
  owner: string,
  repo: string,
  stars: number,
  createdAt: string,
): VideoCard {
  return {
    owner,
    repo,
    title: `${owner}/${repo}`,
    opening: "",
    durationSeconds: 60,
    stars,
    language: "TypeScript",
    createdAt,
  };
}

const cards = [
  card("vercel", "next.js", 130_000, "2026-09-20T12:00:00.000Z"),
  card("acme", "tiny", 5, "2026-09-24T12:00:00.000Z"),
  card("vercel", "swr", 32_000, "2026-09-22T12:00:00.000Z"),
];

function shownRepos() {
  return screen.getAllByRole("link").map((link) => link.getAttribute("href"));
}

describe("VideoCatalog", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/videos");
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the newest videos first by default", () => {
    render(<VideoCatalog cards={cards} />);

    expect(shownRepos()).toEqual([
      "/acme/tiny/video",
      "/vercel/swr/video",
      "/vercel/next.js/video",
    ]);
    expect(screen.getByText(/of 3 videos/)).toBeTruthy();
  });

  it("searches, sorts and filters like browse, and keeps the URL in sync", () => {
    render(<VideoCatalog cards={cards} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "stars_desc" },
    });
    expect(shownRepos()).toEqual([
      "/vercel/next.js/video",
      "/vercel/swr/video",
      "/acme/tiny/video",
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Minimum Stars" }), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "SWR" },
    });
    expect(shownRepos()).toEqual(["/vercel/swr/video"]);
    expect(window.location.search).toBe("?q=SWR&sort=stars_desc&minStars=1000");

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "nothing" },
    });
    expect(screen.getByText("No videos match these filters")).toBeTruthy();
  });

  it("restores the query from the URL and pages through results", () => {
    const many = Array.from({ length: VIDEO_PAGE_SIZE + 2 }, (_, index) =>
      card(
        "owner",
        `repo-${String(index).padStart(2, "0")}`,
        index,
        "2026-09-24T12:00:00.000Z",
      ),
    );
    window.history.replaceState(null, "", "/videos?sort=name_asc");
    render(<VideoCatalog cards={many} />);

    expect(shownRepos()).toHaveLength(VIDEO_PAGE_SIZE);
    expect(shownRepos()[0]).toBe("/owner/repo-00/video");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(shownRepos()).toEqual([
      "/owner/repo-24/video",
      "/owner/repo-25/video",
    ]);
    expect(window.location.search).toBe("?sort=name_asc&page=2");
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });
});
