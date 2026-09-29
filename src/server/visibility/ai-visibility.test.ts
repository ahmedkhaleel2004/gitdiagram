import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { upstashCommand, upstashPipeline } = vi.hoisted(() => ({
  upstashCommand: vi.fn(),
  upstashPipeline: vi.fn(),
}));
vi.mock("~/server/storage/upstash", () => ({
  upstashCommand,
  upstashPipeline,
}));

const { askAssistant } = vi.hoisted(() => ({ askAssistant: vi.fn() }));
vi.mock("./ai-ask", () => ({
  askAssistant,
  providerConfigured: () => true,
  aiVisibilityModels: () => ({
    openai: "gpt-6.1-sol",
    anthropic: "claude-sonnet-5-5",
  }),
}));

import type { AiMode, AiProvider } from "~/features/admin/visibility";
import { AI_VISIBILITY_PROMPTS } from "./ai-answer";
import {
  collectAnswers,
  getAiVisibility,
  runAiVisibility,
} from "./ai-visibility";

const FIRST = AI_VISIBILITY_PROMPTS[0]!.text;

function fakeAsk(provider: AiProvider, prompt: string, mode: AiMode) {
  const names =
    provider === "openai" && mode === "search" && prompt === FIRST
      ? "- **GitDiagram** turns a repo into a diagram (https://gitdiagram.com).\n- **Madge**"
      : provider === "anthropic" && prompt === FIRST
        ? "- **Madge**\n- **GitDiagram**"
        : "Use Madge or Graphviz.";
  return Promise.resolve({
    model: "m",
    text: names,
    citations: [],
    sources: [],
    costUsd: 0.01,
    truncated: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upstashPipeline.mockResolvedValue([]);
});

describe("the daily AI visibility run", () => {
  it("asks every question in every mode and summarizes what came back", async () => {
    askAssistant.mockImplementation(fakeAsk);
    upstashCommand.mockResolvedValue("OK");
    const summary = await runAiVisibility({
      deadline: Date.now() + 60_000,
      now: Date.parse("2026-09-29T13:00:00Z"),
    });
    expect(askAssistant).toHaveBeenCalledTimes(48);
    expect(summary).not.toBeNull();
    expect(summary!.date).toBe("2026-09-29");
    expect(summary!.variants["openai:search"]).toEqual({
      asked: 12,
      answered: 12,
      mentioned: 1,
      cited: 1,
      positionSum: 1,
    });
    expect(summary!.variants["anthropic:memory"]).toMatchObject({
      mentioned: 1,
      cited: 0,
      positionSum: 2,
    });
    expect(summary!.marks["openai:search"]).toBe("200000000000");
    expect(summary!.marks["anthropic:search"]).toBe("100000000000");
    expect(summary!.competitors[0]).toEqual(["Madge", 48]);
    expect(summary!.costUsd).toBeCloseTo(0.48);

    // Stored with a half-year summary and a month of answers.
    const [[summarySet, detailSet]] = upstashPipeline.mock.calls[0] as [
      unknown[][],
    ];
    expect(summarySet!.slice(0, 2)).toEqual([
      "SET",
      "ai-visibility:v1:summary:2026-09-29",
    ]);
    expect(summarySet!.at(-1)).toBe(190 * 86_400);
    expect(detailSet!.at(-1)).toBe(35 * 86_400);
  });

  it("runs once a day unless forced", async () => {
    upstashCommand.mockResolvedValue(null);
    await expect(
      runAiVisibility({ deadline: Date.now() + 60_000 }),
    ).resolves.toBeNull();
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it("stops starting questions once the spend could pass the cap", async () => {
    askAssistant.mockImplementation(fakeAsk);
    const answers = await collectAnswers({
      deadline: Date.now() + 60_000,
      concurrency: 1,
      maxUsd: 0.2,
    });
    expect(answers).toHaveLength(48);
    const asked = answers.filter((answer) => !answer.error).length;
    expect(asked).toBeGreaterThan(0);
    expect(asked).toBeLessThan(48);
    expect(answers.find((answer) => answer.error)?.error).toBe(
      "Over the day's budget.",
    );
  });

  it("records a failed question without stopping the rest", async () => {
    askAssistant.mockImplementation(
      (provider: AiProvider, prompt: string, mode: AiMode) =>
        provider === "anthropic"
          ? Promise.reject(new Error("overloaded"))
          : fakeAsk(provider, prompt, mode),
    );
    const answers = await collectAnswers({ deadline: Date.now() + 60_000 });
    expect(answers.filter((answer) => answer.error)).toHaveLength(24);
    expect(answers[0]).toMatchObject({
      variant: "openai:search",
      promptId: AI_VISIBILITY_PROMPTS[0]!.id,
      mentioned: true,
    });
  });

  it("asks nothing once the deadline is too close", async () => {
    const answers = await collectAnswers({ deadline: Date.now() + 5_000 });
    expect(askAssistant).not.toHaveBeenCalled();
    expect(answers.every((answer) => answer.error === "Out of time.")).toBe(
      true,
    );
  });

  it("reads the trend and the newest day's answers", async () => {
    upstashPipeline.mockResolvedValue([
      { result: null },
      { result: JSON.stringify({ date: "2026-09-28" }) },
      { result: "not json" },
    ]);
    upstashCommand.mockResolvedValue(
      JSON.stringify({ date: "2026-09-28", answers: [] }),
    );
    const result = await getAiVisibility(3, Date.parse("2026-09-29T10:00:00Z"));
    expect(upstashPipeline).toHaveBeenCalledWith([
      ["GET", "ai-visibility:v1:summary:2026-09-29"],
      ["GET", "ai-visibility:v1:summary:2026-09-28"],
      ["GET", "ai-visibility:v1:summary:2026-09-27"],
    ]);
    expect(result.summaries).toEqual([{ date: "2026-09-28" }]);
    expect(upstashCommand).toHaveBeenCalledWith([
      "GET",
      "ai-visibility:v1:detail:2026-09-28",
    ]);
    expect(result.latest).toEqual({ date: "2026-09-28", answers: [] });
  });
});
