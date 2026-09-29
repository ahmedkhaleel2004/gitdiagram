import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_VARIANTS,
  type AiAnswer,
  type AiVisibilitySummary,
  type VisibilityReport,
} from "~/features/admin/visibility";
import { VisibilityPanel } from "./visibility-panel";

const stats = (mentioned: number) => ({
  asked: 2,
  answered: 2,
  mentioned,
  cited: mentioned ? 1 : 0,
  positionSum: mentioned,
});

const summary = (date: string, mentioned: number): AiVisibilitySummary => ({
  date,
  ranAt: `${date}T13:00:00.000Z`,
  durationMs: 90_000,
  costUsd: 0.93,
  models: { openai: "gpt-6.1-sol", anthropic: "claude-sonnet-5-5" },
  prompts: ["visualize", "diagram"],
  variants: {
    "openai:search": stats(mentioned),
    "openai:memory": stats(0),
    "anthropic:search": stats(0),
    "anthropic:memory": stats(0),
  },
  marks: {
    "openai:search": mentioned ? "20" : "00",
    "openai:memory": "00",
    "anthropic:search": "0-",
    "anthropic:memory": "00",
  },
  competitors: [["Mermaid", 6]],
});

const answer = (variant: AiAnswer["variant"]): AiAnswer => ({
  variant,
  promptId: "visualize",
  prompt: "How can I visualize the architecture of my codebase?",
  mentioned: variant === "openai:search",
  cited: variant === "openai:search",
  inSources: false,
  position: variant === "openai:search" ? 1 : null,
  tools: ["GitDiagram"],
  text: `Answer from ${variant}`,
  citations: [],
  costUsd: 0.04,
});

const report: VisibilityReport = {
  summaries: [summary("2026-09-29", 1), summary("2026-09-28", 0)],
  latest: { date: "2026-09-29", answers: AI_VARIANTS.map(answer) },
  agents: [
    {
      date: "2026-09-29",
      families: { GPTBot: 4, Googlebot: 9 },
      surfaces: {},
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPanel(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => void render(<VisibilityPanel />));
  return fetchMock;
}

describe("the Search & AI panel", () => {
  it("shows today's mention rate per assistant, the questions and the crawlers", async () => {
    const fetchMock = await renderPanel(
      new Response(JSON.stringify(report), { status: 200 }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/visibility", {
      cache: "no-store",
    });
    expect(screen.getAllByText("ChatGPT · search").length).toBeGreaterThan(0);
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText(/Named in 1 of 2 · linked 1/).textContent).toBe(
      "Named in 1 of 2 · linked 1 · avg place #1.0 · before 0%",
    );
    expect(screen.getByText("Mermaid")).toBeTruthy();
    expect(screen.getByText("GPTBot")).toBeTruthy();
    expect(screen.getByText("Googlebot")).toBeTruthy();
    expect(screen.getByText(/13 today/)).toBeTruthy();

    // The latest answers open under their question.
    fireEvent.click(
      screen.getByText("How can I visualize the architecture of my codebase?"),
    );
    expect(screen.getByText("Answer from anthropic:memory")).toBeTruthy();
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
