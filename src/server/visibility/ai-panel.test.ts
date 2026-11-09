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

const { askPanelEngine, openRouterBalanceUsd } = vi.hoisted(() => ({
  askPanelEngine: vi.fn(),
  openRouterBalanceUsd: vi.fn(),
}));
vi.mock("./ai-panel-ask", () => ({
  askPanelEngine,
  openRouterBalanceUsd,
  panelEngineConfigured: () => true,
  usesOpenRouter: (engine: string) =>
    engine === "gemini" || engine === "perplexity",
  panelModels: () => ({
    chatgpt: "gpt",
    claude: "claude",
    gemini: "gemini",
    perplexity: "sonar",
  }),
}));

import type { PanelAnswer, PanelEngine } from "~/features/admin/ai-panel";
import type { AskResult } from "./ai-ask";
import { askOpenQuestions, panelWeek, runPanelStep } from "./ai-panel";
import { AI_PANEL_PROMPTS, type PanelPrompt } from "./ai-panel-prompts";

const PROMPTS: PanelPrompt[] = [
  { id: "a", group: "situation", text: "Question A", page: "/" },
  { id: "b", group: "comparison", text: "Question B", page: null },
];

const result = (text: string, citations: string[] = []): AskResult => ({
  model: "m",
  text,
  citations,
  sources: citations,
  costUsd: 0.01,
  truncated: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  openRouterBalanceUsd.mockResolvedValue(100);
});

describe("panelWeek", () => {
  it("is the Monday of the UTC week", () => {
    expect(panelWeek(Date.parse("2026-11-09T14:00:00Z"))).toBe("2026-11-09");
    expect(panelWeek(Date.parse("2026-11-15T23:59:00Z"))).toBe("2026-11-09");
    expect(panelWeek(Date.parse("2026-11-16T00:00:00Z"))).toBe("2026-11-16");
  });
});

describe("askOpenQuestions", () => {
  const run = (over: Partial<Parameters<typeof askOpenQuestions>[0]> = {}) => {
    const saved: PanelAnswer[] = [];
    const done = askOpenQuestions({
      stored: new Map(),
      deadline: Date.now() + 120_000,
      maxUsd: 10,
      prompts: PROMPTS,
      save: async (answer) => void saved.push(answer),
      ask: async (engine: PanelEngine, prompt: string) =>
        engine === "chatgpt" && prompt === "Question A"
          ? result("Try **GitDiagram**.", [
              "https://gitdiagram.com/?utm_source=chatgpt.com",
              "https://reddit.com/r/x",
            ])
          : result("- **DeepWiki**", ["https://deepwiki.com/"]),
      ...over,
    });
    return done.then((out) => ({ ...out, saved }));
  };

  it("asks every prompt of every engine and reads each answer", async () => {
    const { saved, asked, spent } = await run();
    expect(asked).toBe(8);
    expect(spent).toBeCloseTo(0.08);
    const hit = saved.find(
      (a) => a.promptId === "a" && a.engine === "chatgpt",
    )!;
    expect(hit).toMatchObject({
      mentioned: true,
      position: 1,
      ourUrls: ["https://gitdiagram.com"],
      otherUrls: ["https://reddit.com/r/x"],
      attempts: 1,
    });
    const miss = saved.find(
      (a) => a.promptId === "b" && a.engine === "claude",
    )!;
    expect(miss).toMatchObject({
      mentioned: false,
      competitors: ["DeepWiki"],
      otherUrls: ["https://deepwiki.com"],
    });
  });

  it("skips what is already answered and retries a failure once", async () => {
    const ok = { costUsd: 0.5, attempts: 1 } as PanelAnswer;
    const stored = new Map<string, PanelAnswer>([
      ["a|chatgpt", ok],
      ["a|claude", { ...ok, error: "x", attempts: 1 }],
      ["a|gemini", { ...ok, error: "x", attempts: 2 }],
    ]);
    const { saved } = await run({ stored });
    const keys = saved.map((a) => `${a.promptId}|${a.engine}`);
    expect(keys).toContain("a|claude");
    expect(keys).not.toContain("a|chatgpt");
    expect(keys).not.toContain("a|gemini");
    expect(
      saved.find((a) => a.engine === "claude" && a.promptId === "a")!.attempts,
    ).toBe(2);
  });

  it("stops at the cap, counting what the week already spent", async () => {
    const stored = new Map<string, PanelAnswer>([
      ["x|chatgpt", { costUsd: 9.97, attempts: 1 } as PanelAnswer],
    ]);
    const { saved, asked } = await run({ stored, concurrency: 1 });
    expect(asked).toBe(2); // only Perplexity's $0.015 reserve fits
    expect(
      saved.filter((a) => a.error === "Over the week's budget.").length,
    ).toBe(6);
  });

  it("skips Gemini and Perplexity when the OpenRouter balance is under the floor", async () => {
    const { saved, asked } = await run({
      openRouterBalance: async () => 4,
      openRouterFloor: 15,
    });
    expect(asked).toBe(4);
    const skipped = saved.filter((a) => a.error?.startsWith("Skipped"));
    expect(skipped.map((a) => a.engine).sort()).toEqual([
      "gemini",
      "gemini",
      "perplexity",
      "perplexity",
    ]);
    expect(skipped[0]!.attempts).toBe(2);
  });

  it("records a failed question and leaves the rest for the next firing near the deadline", async () => {
    const failing = await run({
      engines: ["chatgpt"],
      ask: async () => {
        throw new Error("rate limited");
      },
    });
    expect(failing.saved.map((a) => a.error)).toEqual([
      "rate limited",
      "rate limited",
    ]);
    const late = await run({ deadline: Date.now() + 30_000 });
    expect(late.saved).toEqual([]);
  });
});

describe("runPanelStep", () => {
  it("does nothing while another step holds the lock, or once the week is done", async () => {
    upstashCommand.mockResolvedValueOnce(null);
    expect(
      await runPanelStep({
        deadline: Date.now() + 60_000,
        now: Date.parse("2026-11-09T14:00:00Z"),
      }),
    ).toEqual({ skipped: "busy", week: "2026-11-09" });

    upstashCommand.mockImplementation(async (command: unknown[]) =>
      command[0] === "SET"
        ? "OK"
        : command[0] === "GET"
          ? JSON.stringify({ finishedAt: "2026-11-09T15:00:00Z" })
          : 1,
    );
    expect(
      await runPanelStep({
        deadline: Date.now() + 60_000,
        now: Date.parse("2026-11-09T14:00:00Z"),
      }),
    ).toEqual({ skipped: "done", week: "2026-11-09" });
    expect(askPanelEngine).not.toHaveBeenCalled();
    // The lock is given back.
    expect(upstashCommand).toHaveBeenLastCalledWith([
      "DEL",
      "ai-panel:v1:lock:2026-11-09",
    ]);
  });

  it("saves each answer as it lands and writes the final report", async () => {
    upstashCommand.mockImplementation(async (command: unknown[]) => {
      if (command[0] === "SET") return "OK";
      if (command[0] === "HGETALL") return [];
      if (command[0] === "GET")
        return command[1] === "ai-panel:v1:started:2026-11-09"
          ? "2026-11-09T14:00:00.000Z"
          : null;
      return 1;
    });
    upstashPipeline.mockResolvedValue([]);
    askPanelEngine.mockResolvedValue(result("Use **GitDiagram**."));
    const out = await runPanelStep({
      deadline: Date.now() + 200_000,
      now: Date.parse("2026-11-09T14:00:00Z"),
    });
    const total = AI_PANEL_PROMPTS.length * 4;
    expect(out).toMatchObject({
      week: "2026-11-09",
      asked: total,
      open: 0,
      finished: true,
    });
    const hsets = upstashPipeline.mock.calls.filter(
      ([commands]) => (commands as unknown[][])[0]![0] === "HSET",
    );
    expect(hsets.length).toBe(total);
    const final = upstashPipeline.mock.calls.at(-1)![0] as unknown[][];
    expect(final[0]![1]).toBe("ai-panel:v1:report:2026-11-09");
    const report = JSON.parse(final[0]![2] as string);
    expect(report.finishedAt).not.toBeNull();
    expect(report.engines.chatgpt.mentioned).toBe(AI_PANEL_PROMPTS.length);
    expect(report.covered).toBe(AI_PANEL_PROMPTS.length);
  });
});
