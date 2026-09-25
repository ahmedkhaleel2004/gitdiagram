import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoCatalog } from "~/components/explainer/video-catalog";
import { getBrowsePageFromEntries } from "~/features/browse/catalog";
import {
  VIDEO_PAGE_SIZE,
  type VideoCard,
  type VideoPage,
} from "~/features/explainer/catalog-types";

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

/** The server's answer for a query over these cards (see getVideoPage). */
function pageOf(all: VideoCard[], params: URLSearchParams): VideoPage {
  const { items, ...page } = getBrowsePageFromEntries(
    all.map((each) => ({
      username: each.owner,
      repo: each.repo,
      lastSuccessfulAt: each.createdAt,
      stargazerCount: each.stars,
      card: each,
    })),
    {
      q: params.get("q"),
      sort: params.get("sort"),
      minStars: params.get("minStars"),
      page: params.get("page"),
    },
    VIDEO_PAGE_SIZE,
  );
  return { ...page, cards: items.map((item) => item.card) };
}

/** A gallery API over these cards; records the queries it was asked. */
function serve(all: VideoCard[]) {
  const fetchMock = vi.fn(async (url: string) => {
    const params = new URL(url, "https://gitdiagram.com").searchParams;
    return Response.json(pageOf(all, params));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const first = (all: VideoCard[]) => pageOf(all, new URLSearchParams());

function shownRepos() {
  return screen.getAllByRole("link").map((link) => link.getAttribute("href"));
}

describe("VideoCatalog", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/videos");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the first page it was given, newest first, without asking again", () => {
    const fetchMock = serve(cards);
    render(<VideoCatalog initial={first(cards)} />);

    expect(shownRepos()).toEqual([
      "/acme/tiny/video",
      "/vercel/swr/video",
      "/vercel/next.js/video",
    ]);
    expect(screen.getByText(/of 3 videos/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches, sorts and filters on the server, and keeps the URL in sync", async () => {
    const fetchMock = serve(cards);
    render(<VideoCatalog initial={first(cards)} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "stars_desc" },
    });
    await waitFor(() =>
      expect(shownRepos()).toEqual([
        "/vercel/next.js/video",
        "/vercel/swr/video",
        "/acme/tiny/video",
      ]),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/video/catalog?sort=stars_desc",
      expect.objectContaining({ credentials: "omit" }),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Minimum Stars" }), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "SWR" },
    });
    await waitFor(() => expect(shownRepos()).toEqual(["/vercel/swr/video"]));
    expect(window.location.search).toBe("?q=SWR&sort=stars_desc&minStars=1000");

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "nothing" },
    });
    expect(
      await screen.findByText("No videos match these filters"),
    ).toBeTruthy();
  });

  it("restores the query from the URL and pages through results", async () => {
    const many = Array.from({ length: VIDEO_PAGE_SIZE + 2 }, (_, index) =>
      card(
        "owner",
        `repo-${String(index).padStart(2, "0")}`,
        index,
        "2026-09-24T12:00:00.000Z",
      ),
    );
    serve(many);
    window.history.replaceState(null, "", "/videos?sort=name_asc");
    render(<VideoCatalog initial={first(many)} />);

    await waitFor(() => expect(shownRepos()[0]).toBe("/owner/repo-00/video"));
    expect(shownRepos()).toHaveLength(VIDEO_PAGE_SIZE);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(shownRepos()).toEqual([
        "/owner/repo-24/video",
        "/owner/repo-25/video",
      ]),
    );
    expect(window.location.search).toBe("?sort=name_asc&page=2");
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });

  it("does not ask twice for a page it already has", async () => {
    const fetchMock = serve(cards);
    render(<VideoCatalog initial={first(cards)} />);
    const sort = screen.getByRole("combobox", { name: "Sort" });
    fireEvent.change(sort, { target: { value: "stars_desc" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(sort, { target: { value: "recent_desc" } });
    fireEvent.change(sort, { target: { value: "stars_desc" } });
    await waitFor(() => expect(shownRepos()[0]).toBe("/vercel/next.js/video"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says so when a page cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    render(<VideoCatalog initial={first(cards)} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "stars_desc" },
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("The videos could not be loaded")).toBeTruthy();
  });

  it("invites the first video when there are none", () => {
    render(<VideoCatalog initial={first([])} />);
    expect(screen.getByText(/No videos yet/)).toBeTruthy();
  });
});
