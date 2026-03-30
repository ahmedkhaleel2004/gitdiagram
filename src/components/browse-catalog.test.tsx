import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowseCatalog } from "~/components/browse-catalog";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("~/components/browse-diagram-preview", () => ({
  preloadBrowseDiagramPreviewChart: vi.fn(),
  BrowseDiagramPreview: ({
    repoLabel,
  }: {
    repoLabel: string;
  }) => <div data-testid="mermaid-preview">{repoLabel}</div>,
}));

describe("BrowseCatalog", () => {
  let getEntriesByTypeSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  const createMatchMediaResult = (matches: boolean): MediaQueryList =>
    ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: "",
      onchange: null,
      removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList;

  afterEach(() => {
    cleanup();
    getEntriesByTypeSpy?.mockRestore();
    fetchSpy?.mockRestore();
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  beforeEach(() => {
    window.history.replaceState(null, "", "/browse");
    window.scrollTo = vi.fn();
    window.matchMedia = vi
      .fn()
      .mockImplementation(() => createMatchMediaResult(false));
    getEntriesByTypeSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([]);
  });

  it("renders an empty state when no browse results match", () => {
    render(
      <BrowseCatalog
        entries={[]}
        initialQuery={{}}
      />,
    );

    expect(
      screen.getByText("No diagrams match these filters"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Open Diagram")).not.toBeInTheDocument();
  });

  it("filters instantly as the user types and removes apply/reset controls", () => {
    render(
      <BrowseCatalog
        entries={[
          {
            username: "vercel",
            repo: "next.js",
            lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
            stargazerCount: 130000,
          },
          {
            username: "acme",
            repo: "demo",
            lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
            stargazerCount: 20,
          },
        ]}
        initialQuery={{}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reset" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "acme" },
    });

    const acmeRow = screen.getByText("acme/demo").closest("tr");

    expect(acmeRow).not.toBeNull();
    expect(within(acmeRow!).getByRole("link", { name: "Open Diagram" })).toHaveAttribute(
      "href",
      "/acme/demo",
    );
    expect(screen.queryByText("vercel/next.js")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?q=acme");
  });

  it("keeps pagination local and preserves filters in the URL", () => {
    render(
      <BrowseCatalog
        entries={Array.from({ length: 60 }, (_, index) => ({
          username: "vercel",
          repo: `repo-${index + 1}`,
          lastSuccessfulAt: `2026-03-${String(29 - (index % 20)).padStart(2, "0")}T12:00:00.000Z`,
          stargazerCount: 500 - index,
        }))}
        initialQuery={{
          q: "vercel",
          sort: "stars_desc",
          minStars: 100,
          page: "2",
        }}
      />,
    );

    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(window.location.search).toBe(
      "?q=vercel&sort=stars_desc&minStars=100",
    );
    const firstRow = screen.getByText("vercel/repo-1").closest("tr");

    expect(firstRow).not.toBeNull();
    expect(within(firstRow!).getByRole("link", { name: "Open Diagram" })).toHaveAttribute(
      "href",
      "/vercel/repo-1",
    );
    expect(screen.queryByTestId("mermaid-preview")).not.toBeInTheDocument();
  });

  it("restores the last browse state on browser back when the URL returns bare", () => {
    window.sessionStorage.setItem(
      "gitdiagram:browse-query",
      JSON.stringify({
        q: "vercel",
        sort: "stars_desc",
        minStars: 100,
        page: 2,
      }),
    );
    getEntriesByTypeSpy.mockReturnValue([
      { type: "back_forward" } as PerformanceNavigationTiming,
    ]);

    render(
      <BrowseCatalog
        entries={Array.from({ length: 40 }, (_, index) => ({
          username: "vercel",
          repo: `repo-${index + 1}`,
          lastSuccessfulAt: `2026-03-${String(29 - (index % 20)).padStart(2, "0")}T12:00:00.000Z`,
          stargazerCount: 500 - index,
        }))}
        initialQuery={{}}
      />,
    );

    expect(screen.getByRole("searchbox")).toHaveValue("vercel");
    expect(screen.getByDisplayValue("Most Stars")).toBeInTheDocument();
    expect(screen.getByDisplayValue("100+")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(window.location.search).toBe("?q=vercel&sort=stars_desc&minStars=100&page=2");
  });

  it("prefers the live URL page over stale initial query state on mount", () => {
    window.history.replaceState(
      null,
      "",
      "/browse?q=vercel&sort=stars_desc&minStars=100&page=2",
    );

    render(
      <BrowseCatalog
        entries={Array.from({ length: 40 }, (_, index) => ({
          username: "vercel",
          repo: `repo-${index + 1}`,
          lastSuccessfulAt: `2026-03-${String(29 - (index % 20)).padStart(2, "0")}T12:00:00.000Z`,
          stargazerCount: 500 - index,
        }))}
        initialQuery={{
          q: "vercel",
          sort: "stars_desc",
          minStars: 100,
          page: "1",
        }}
      />,
    );

    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("opens a desktop hover preview for repository cell hover and reuses cached data", async () => {
    vi.useFakeTimers();
    window.matchMedia = vi
      .fn()
      .mockImplementation(() => createMatchMediaResult(true));
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ diagram: "flowchart TD\nA-->B" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <BrowseCatalog
        entries={[
          {
            username: "vercel",
            repo: "next.js",
            lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
            stargazerCount: 130000,
          },
        ]}
        initialQuery={{}}
      />,
    );
    await Promise.resolve();

    const repoCell = screen.getByText("vercel/next.js").closest("td");

    expect(repoCell).not.toBeNull();

    await act(async () => {
      fireEvent.mouseEnter(repoCell!, { clientX: 120, clientY: 140 });
      await vi.advanceTimersByTimeAsync(100);
    });
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(repoCell!);

    await act(async () => {
      fireEvent.mouseEnter(repoCell!, { clientX: 160, clientY: 180 });
      await vi.advanceTimersByTimeAsync(100);
    });
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses preloaded default preview diagrams without fetching on hover", async () => {
    vi.useFakeTimers();
    window.matchMedia = vi
      .fn()
      .mockImplementation(() => createMatchMediaResult(true));
    fetchSpy = vi.spyOn(global, "fetch");

    render(
      <BrowseCatalog
        entries={[
          {
            username: "vercel",
            repo: "next.js",
            lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
            stargazerCount: 130000,
          },
        ]}
        initialPreviewDiagrams={{
          "vercel/next.js": "flowchart TD\nA-->B",
        }}
        initialQuery={{}}
      />,
    );
    await Promise.resolve();

    const repoCell = screen.getByText("vercel/next.js").closest("td");

    expect(repoCell).not.toBeNull();

    await act(async () => {
      fireEvent.mouseEnter(repoCell!, { clientX: 120, clientY: 140 });
      await vi.advanceTimersByTimeAsync(100);
    });
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the repository name as text and keeps diagram navigation on the action button", () => {
    render(
      <BrowseCatalog
        entries={[
          {
            username: "vercel",
            repo: "next.js",
            lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
            stargazerCount: 130000,
          },
        ]}
        initialQuery={{}}
      />,
    );

    const repoRow = screen.getByText("vercel/next.js").closest("tr");

    expect(screen.queryByRole("link", { name: "vercel/next.js" })).not.toBeInTheDocument();
    expect(repoRow).not.toBeNull();
    expect(within(repoRow!).getByRole("link", { name: "Open Diagram" })).toHaveAttribute(
      "href",
      "/vercel/next.js",
    );
  });
});
