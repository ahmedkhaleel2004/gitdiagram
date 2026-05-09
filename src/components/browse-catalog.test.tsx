import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowseCatalog } from "~/components/browse-catalog";
import type {
  BrowseIndexEntry,
  BrowsePageResult,
} from "~/features/browse/catalog";
import { clearBrowsePageCacheForTest } from "~/features/browse/index-client";

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
  BrowseDiagramPreview: ({ repoLabel }: { repoLabel: string }) => (
    <div data-testid="mermaid-preview">{repoLabel}</div>
  ),
}));

function createBrowseResult(
  items: BrowseIndexEntry[],
  overrides: Partial<BrowsePageResult> = {},
): BrowsePageResult {
  return {
    items,
    total: overrides.total ?? items.length,
    page: overrides.page ?? 1,
    pageSize: overrides.pageSize ?? 20,
    totalPages: overrides.totalPages ?? 1,
    sort: overrides.sort ?? "recent_desc",
    q: overrides.q ?? "",
    minStars: overrides.minStars ?? 0,
  };
}

function createEntry(
  repo: string,
  overrides: Partial<BrowseIndexEntry> = {},
): BrowseIndexEntry {
  return {
    username: overrides.username ?? "vercel",
    repo,
    lastSuccessfulAt: overrides.lastSuccessfulAt ?? "2026-03-29T12:00:00.000Z",
    stargazerCount: overrides.stargazerCount ?? 130000,
  };
}

describe("BrowseCatalog", () => {
  let getEntriesByTypeSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
  let previewFetches = 0;

  const createMatchMediaResult = (matches: boolean): MediaQueryList =>
    ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: "",
      onchange: null,
      removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList;

  function mockFetch(
    resolveBrowseResult: (url: URL) => BrowsePageResult | null,
  ) {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation((input) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      const url = new URL(rawUrl, "https://gitdiagram.com");

      if (url.pathname === "/api/diagram-preview") {
        previewFetches += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ diagram: "flowchart TD\nA-->B" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      const result = resolveBrowseResult(url);
      return Promise.resolve(
        new Response(result ? JSON.stringify(result) : "", {
          status: result ? 200 : 404,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  }

  afterEach(() => {
    cleanup();
    clearBrowsePageCacheForTest();
    getEntriesByTypeSpy?.mockRestore();
    fetchSpy?.mockRestore();
    previewFetches = 0;
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

  it("renders an empty state when no browse results match", async () => {
    mockFetch(() => createBrowseResult([], { total: 0 }));

    render(<BrowseCatalog initialQuery={{}} />);

    expect(
      await screen.findByText("No diagrams match these filters"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Open Diagram")).not.toBeInTheDocument();
  });

  it("fetches server search results as the user types and removes apply/reset controls", async () => {
    const acmeEntry = createEntry("demo", {
      username: "acme",
      stargazerCount: 20,
    });
    const allEntries = [createEntry("next.js"), acmeEntry];
    mockFetch((url) => {
      const q = url.searchParams.get("q") ?? "";
      const items = q === "acme" ? [acmeEntry] : allEntries;
      return createBrowseResult(items, { q });
    });

    render(<BrowseCatalog initialQuery={{}} />);

    expect(await screen.findByText("vercel/next.js")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Reset" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "acme" },
    });

    const acmeRow = await screen.findByText("acme/demo");

    expect(acmeRow.closest("tr")).not.toBeNull();
    expect(
      within(acmeRow.closest("tr")!).getByRole("link", {
        name: "Open Diagram",
      }),
    ).toHaveAttribute("href", "/acme/demo");
    await waitFor(() => {
      expect(screen.queryByText("vercel/next.js")).not.toBeInTheDocument();
    });
    expect(window.location.search).toBe("?q=acme");
  });

  it("uses server pagination and preserves filters in the URL", async () => {
    mockFetch((url) => {
      const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      return createBrowseResult([createEntry(`repo-${page === 1 ? 1 : 21}`)], {
        page,
        total: 60,
        totalPages: 3,
        q: "vercel",
        sort: "stars_desc",
        minStars: 100,
      });
    });

    render(
      <BrowseCatalog
        initialQuery={{
          q: "vercel",
          sort: "stars_desc",
          minStars: 100,
          page: "2",
        }}
      />,
    );

    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
    expect(window.location.search).toBe(
      "?q=vercel&sort=stars_desc&minStars=100",
    );
    const firstRow = screen.getByText("vercel/repo-1").closest("tr");

    expect(firstRow).not.toBeNull();
    expect(
      within(firstRow!).getByRole("link", { name: "Open Diagram" }),
    ).toHaveAttribute("href", "/vercel/repo-1");
    expect(screen.queryByTestId("mermaid-preview")).not.toBeInTheDocument();
  });

  it("restores the last browse state on browser back when the URL returns bare", async () => {
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
    mockFetch(() =>
      createBrowseResult([createEntry("repo-21")], {
        page: 2,
        total: 40,
        totalPages: 2,
        q: "vercel",
        sort: "stars_desc",
        minStars: 100,
      }),
    );

    render(<BrowseCatalog initialQuery={{}} />);

    expect(await screen.findByRole("searchbox")).toHaveValue("vercel");
    expect(screen.getByDisplayValue("Most Stars")).toBeInTheDocument();
    expect(screen.getByDisplayValue("100+")).toBeInTheDocument();
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    expect(window.location.search).toBe(
      "?q=vercel&sort=stars_desc&minStars=100&page=2",
    );
  });

  it("prefers the live URL page over stale initial query state on mount", async () => {
    window.history.replaceState(
      null,
      "",
      "/browse?q=vercel&sort=stars_desc&minStars=100&page=2",
    );
    mockFetch(() =>
      createBrowseResult([createEntry("repo-21")], {
        page: 2,
        total: 40,
        totalPages: 2,
        q: "vercel",
        sort: "stars_desc",
        minStars: 100,
      }),
    );

    render(
      <BrowseCatalog
        initialQuery={{
          q: "vercel",
          sort: "stars_desc",
          minStars: 100,
          page: "1",
        }}
      />,
    );

    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("opens a desktop hover preview for repository cell hover and reuses cached data", async () => {
    window.matchMedia = vi
      .fn()
      .mockImplementation(() => createMatchMediaResult(true));
    mockFetch(() => createBrowseResult([createEntry("next.js")]));

    render(<BrowseCatalog initialQuery={{}} />);

    const repoCell = (await screen.findByText("vercel/next.js")).closest("td");

    expect(repoCell).not.toBeNull();
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.mouseEnter(repoCell!, { clientX: 120, clientY: 140 });
      await vi.advanceTimersByTimeAsync(100);
    });
    await Promise.resolve();

    expect(previewFetches).toBe(1);

    fireEvent.mouseLeave(repoCell!);

    await act(async () => {
      fireEvent.mouseEnter(repoCell!, { clientX: 160, clientY: 180 });
      await vi.advanceTimersByTimeAsync(100);
    });
    await Promise.resolve();

    expect(previewFetches).toBe(1);
  });

  it("uses preloaded default preview diagrams without fetching on hover", async () => {
    window.matchMedia = vi
      .fn()
      .mockImplementation(() => createMatchMediaResult(true));
    mockFetch(() => createBrowseResult([createEntry("next.js")]));

    render(
      <BrowseCatalog
        initialPreviewDiagrams={{
          "vercel/next.js": "flowchart TD\nA-->B",
        }}
        initialQuery={{}}
      />,
    );

    const repoCell = (await screen.findByText("vercel/next.js")).closest("td");

    expect(repoCell).not.toBeNull();
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.mouseEnter(repoCell!, { clientX: 120, clientY: 140 });
      await vi.advanceTimersByTimeAsync(100);
    });
    await Promise.resolve();

    expect(previewFetches).toBe(0);
  });

  it("renders the repository name as text and keeps diagram navigation on the action button", async () => {
    mockFetch(() => createBrowseResult([createEntry("next.js")]));

    render(<BrowseCatalog initialQuery={{}} />);

    const repoRow = (await screen.findByText("vercel/next.js")).closest("tr");

    expect(
      screen.queryByRole("link", { name: "vercel/next.js" }),
    ).not.toBeInTheDocument();
    expect(repoRow).not.toBeNull();
    expect(
      within(repoRow!).getByRole("link", { name: "Open Diagram" }),
    ).toHaveAttribute("href", "/vercel/next.js");
  });
});
