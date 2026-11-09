import { describe, expect, it } from "vitest";

import type { PanelAnswer } from "~/features/admin/ai-panel";
import {
  buildPanelReport,
  isOurs,
  isThirdParty,
  normalizeUrl,
} from "./ai-panel-gaps";
import { SITUATION_SLUGS } from "~/features/situations/slugs";
import { COMPARE_SLUGS } from "~/features/compare/slugs";
import { AI_PANEL_PROMPTS, type PanelPrompt } from "./ai-panel-prompts";

const answer = (over: Partial<PanelAnswer>): PanelAnswer => ({
  promptId: "p",
  engine: "chatgpt",
  model: "m",
  mentioned: false,
  position: null,
  ourUrls: [],
  otherUrls: [],
  inSources: false,
  competitors: [],
  text: "",
  costUsd: 0.01,
  attempts: 1,
  ...over,
});

const prompt = (over: Partial<PanelPrompt>): PanelPrompt => ({
  id: "p",
  group: "situation",
  text: "How do I see a repo's architecture?",
  page: "/visualize-codebase",
  ...over,
});

const report = (prompts: PanelPrompt[], answers: PanelAnswer[]) =>
  buildPanelReport({
    week: "2026-11-09",
    startedAt: "2026-11-09T14:00:00.000Z",
    finishedAt: null,
    prompts,
    answers,
  });

describe("the prompt panel's prompts", () => {
  it("are about 100, with unique ids, in all four groups", () => {
    expect(AI_PANEL_PROMPTS.length).toBeGreaterThanOrEqual(95);
    expect(new Set(AI_PANEL_PROMPTS.map((p) => p.id)).size).toBe(
      AI_PANEL_PROMPTS.length,
    );
    expect(new Set(AI_PANEL_PROMPTS.map((p) => p.group))).toEqual(
      new Set(["situation", "comparison", "constraint", "repo"]),
    );
    for (const p of AI_PANEL_PROMPTS)
      expect(p.page !== null || Boolean(p.wanted)).toBe(true);
  });

  it("point only at comparison pages that exist", () => {
    for (const p of AI_PANEL_PROMPTS) {
      const slug = /^\/compare\/(.+)$/.exec(p.page ?? "")?.[1];
      if (slug) expect(COMPARE_SLUGS).toContain(slug);
    }
  });

  it("point only at situation guides that exist", () => {
    for (const p of AI_PANEL_PROMPTS) {
      const slug = /^\/guides\/(.+)$/.exec(p.page ?? "")?.[1];
      if (slug) expect(SITUATION_SLUGS).toContain(slug);
    }
  });
});

describe("urls", () => {
  it("normalizes tracking, www and trailing slashes", () => {
    expect(
      normalizeUrl("https://www.Example.com/a/?utm_source=chatgpt.com&x=1#h"),
    ).toBe("https://example.com/a?x=1");
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("ftp://x.com/")).toBeNull();
  });

  it("tells our pages, lists and forums apart", () => {
    expect(isOurs("https://gitdiagram.com/x")).toBe(true);
    expect(isOurs("https://notgitdiagram.com/")).toBe(false);
    expect(isThirdParty("https://reddit.com/r/programming/x")).toBe(true);
    expect(isThirdParty("https://blog.example.com/best-code-visualizers")).toBe(
      true,
    );
    expect(isThirdParty("https://deepwiki.com/")).toBe(false);
    expect(isThirdParty("https://github.com/facebook/react")).toBe(false);
    expect(isThirdParty("https://github.com/x/awesome-code-tools")).toBe(true);
  });
});

describe("buildPanelReport", () => {
  it("counts per engine and leaves covered prompts out of the gaps", () => {
    const r = report(
      [prompt({})],
      [
        answer({
          mentioned: true,
          position: 2,
          ourUrls: ["https://gitdiagram.com"],
        }),
        answer({ engine: "claude", mentioned: true, position: 1 }),
        answer({ engine: "gemini", error: "boom", costUsd: 0 }),
      ],
    );
    expect(r.engines.chatgpt).toMatchObject({
      asked: 1,
      answered: 1,
      mentioned: 1,
      cited: 1,
      positionSum: 2,
    });
    expect(r.engines.gemini).toMatchObject({ asked: 1, answered: 0 });
    expect(r.covered).toBe(1);
    expect(r.gaps).toEqual([]);
    expect(r.costUsd).toBe(0.02);
  });

  it("calls a page weak when search found us but the answer left us out", () => {
    const r = report([prompt({})], [answer({ inSources: true })]);
    expect(r.gaps[0]!.diagnosis).toBe("weak page");
  });

  it("calls a page missing when none answers the question", () => {
    const r = report(
      [prompt({ page: null, wanted: "/compare/deepwiki" })],
      [answer({ otherUrls: ["https://deepwiki.com"] })],
    );
    expect(r.gaps[0]!.diagnosis).toBe("missing page");
    expect(r.gaps[0]!.fix).toContain("/compare/deepwiki");
  });

  it("calls it a third-party gap when lists and forums are cited", () => {
    const r = report(
      [prompt({})],
      [
        answer({
          otherUrls: ["https://reddit.com/r/x", "https://dev.to/best-tools"],
          competitors: ["Madge"],
        }),
        answer({ engine: "claude", otherUrls: ["https://reddit.com/r/x"] }),
      ],
    );
    const gap = r.gaps[0]!;
    expect(gap.diagnosis).toBe("third-party gap");
    expect(gap.fix).toContain("https://reddit.com/r/x");
    expect(gap.citedInstead[0]).toEqual(["https://reddit.com/r/x", 2]);
    expect(gap.missedBy).toEqual(["chatgpt", "claude"]);
    expect(gap.competitors).toEqual(["Madge"]);
    expect(r.topCited[0]).toEqual(["https://reddit.com/r/x", 2]);
    expect(r.topHosts[0]).toEqual(["reddit.com", 2]);
  });

  it("calls our page inaccessible when engines cite product sites, not us", () => {
    const r = report(
      [prompt({})],
      [answer({ otherUrls: ["https://deepwiki.com", "https://codeviz.ai"] })],
    );
    expect(r.gaps[0]!.diagnosis).toBe("inaccessible page");
  });

  it("puts prompts missed by the most engines first", () => {
    const r = report(
      [prompt({ id: "a" }), prompt({ id: "b" })],
      [
        answer({ promptId: "a" }),
        answer({ promptId: "a", engine: "claude", mentioned: true }),
        answer({ promptId: "b" }),
        answer({ promptId: "b", engine: "claude" }),
      ],
    );
    expect(r.gaps.map((gap) => gap.promptId)).toEqual(["b", "a"]);
  });
});
