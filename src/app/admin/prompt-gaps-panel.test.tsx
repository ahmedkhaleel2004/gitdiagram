import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_ENGINES,
  type PanelEngineStats,
  type PanelView,
} from "~/features/admin/ai-panel";
import { PromptGapsPanel } from "./prompt-gaps-panel";

const stats = (mentioned: number): PanelEngineStats => ({
  asked: 4,
  answered: 4,
  mentioned,
  cited: 0,
  positionSum: mentioned,
  costUsd: 0.1,
});

const engines = Object.fromEntries(
  PANEL_ENGINES.map((engine) => [engine, stats(engine === "gemini" ? 2 : 1)]),
) as PanelView["history"][number]["engines"];

const view: PanelView = {
  latest: {
    week: "2026-11-09",
    startedAt: "2026-11-09T14:00:00.000Z",
    finishedAt: "2026-11-09T14:40:00.000Z",
    costUsd: 0.4,
    prompts: 4,
    models: { gemini: "google/gemini-3.8-flash" },
    engines,
    covered: 1,
    gaps: [
      {
        promptId: "c-deepwiki-alternatives",
        group: "comparison",
        text: "What are some DeepWiki alternatives?",
        missedBy: ["chatgpt", "claude"],
        namedBy: ["gemini"],
        page: null,
        diagnosis: "missing page",
        fix: "Build /compare/deepwiki.",
        citedInstead: [["https://reddit.com/r/x", 2]],
        competitors: ["DeepWiki"],
      },
      {
        promptId: "s-joined-monorepo",
        group: "situation",
        text: "Huge monorepo, how do I understand it?",
        missedBy: ["chatgpt"],
        namedBy: [],
        page: "/visualize-codebase",
        diagnosis: "third-party gap",
        fix: "Get listed on reddit.",
        citedInstead: [],
        competitors: [],
      },
    ],
    topCited: [["https://reddit.com/r/x", 3]],
    topHosts: [["reddit.com", 3]],
    competitors: [["DeepWiki", 5]],
  },
  history: [{ week: "2026-11-02", costUsd: 9, engines }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPanel(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => void render(<PromptGapsPanel />));
  return fetchMock;
}

describe("the Prompt gaps panel", () => {
  it("shows each engine's rate, every gap with its fix, and the outreach list", async () => {
    const fetchMock = await renderPanel(
      new Response(JSON.stringify(view), { status: 200 }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/ai-panel", {
      cache: "no-store",
    });
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Gemini · google/gemini-3.8-flash")).toBeTruthy();
    expect(screen.getByText(/Week of 2026-11-09 · done · \$0.40/)).toBeTruthy();
    expect(screen.getAllByText("https://reddit.com/r/x").length).toBe(2);
    expect(screen.getByText("reddit.com")).toBeTruthy();
    expect(screen.getByText(/Earlier weeks: 2026-11-02/)).toBeTruthy();

    fireEvent.click(screen.getByText("What are some DeepWiki alternatives?"));
    expect(screen.getByText("Build /compare/deepwiki.")).toBeTruthy();

    // Filtering by diagnosis leaves the other gaps out.
    fireEvent.click(screen.getByRole("button", { name: "missing page 1" }));
    expect(
      screen.queryByText("Huge monorepo, how do I understand it?"),
    ).toBeNull();
  });

  it("says so when the report cannot be read", async () => {
    await renderPanel(
      new Response(JSON.stringify({ error: "Redis could not be read." }), {
        status: 503,
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Redis could not be read.",
    );
  });
});
