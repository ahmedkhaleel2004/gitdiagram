import { describe, expect, it } from "vitest";
import { GUIDE_INTRODUCTION, guideSections } from "~/features/guide/content";
import {
  COMPARE_PAGES,
  ROUNDUP_META_TITLE,
  ROUNDUP_PATH,
  ROUNDUP_TOOLS,
  comparePath,
} from "./content";
import { comparePageMarkdown, roundupMarkdown } from "./markdown";
import { COMPARE_SLUGS } from "./slugs";

const SITE_PAGES = new Set([
  "/",
  "/visualize-codebase",
  "/browse",
  "/videos",
  "/reels",
  "/privacy",
  ROUNDUP_PATH,
  ...COMPARE_PAGES.map((page) => comparePath(page.slug)),
]);

function siteLinks(text: string): string[] {
  return Array.from(text.matchAll(/\]\((\/[^)]*)\)/g), (match) => match[1]!);
}

describe("comparison pages", () => {
  it("match the slugs the Worker's firewall knows", () => {
    expect(COMPARE_PAGES.map((page) => page.slug)).toEqual([...COMPARE_SLUGS]);
  });

  it("have titles that fit a search result and unique slugs", () => {
    expect(new Set(COMPARE_PAGES.map((page) => page.slug)).size).toBe(
      COMPARE_PAGES.length,
    );
    for (const page of [
      ...COMPARE_PAGES.map((p) => p.metaTitle),
      ROUNDUP_META_TITLE,
    ])
      expect(page.length).toBeLessThanOrEqual(60);
    for (const page of COMPARE_PAGES)
      expect(page.description.length).toBeLessThanOrEqual(200);
  });

  it("each give both sides, sources and the same repository in both", () => {
    for (const page of COMPARE_PAGES) {
      expect(page.verdict).toContain(page.tool);
      expect(page.chooseOther.length).toBeGreaterThanOrEqual(3);
      expect(page.chooseGitDiagram.length).toBeGreaterThanOrEqual(3);
      expect(page.questions.length).toBeGreaterThanOrEqual(2);
      expect(page.sources.length).toBeGreaterThanOrEqual(3);
      for (const source of page.sources)
        expect(source.url).toMatch(/^https:\/\//);
      const example = page.sections.find(
        (section) => section.id === "same-repository",
      );
      expect(example).toBeDefined();
      // Points at a real stored diagram on this site.
      expect(page.sections.flatMap((s) => s.paragraphs).join(" ")).toMatch(
        /\]\(\/(?:expressjs\/express|fastapi\/fastapi)\)/,
      );
    }
  });

  it("link only to pages this site has (repositories aside)", () => {
    const texts = [
      GUIDE_INTRODUCTION,
      ...guideSections({ videos: true }).flatMap((section) => [
        ...section.paragraphs,
        ...(section.entries ?? []).map((entry) => entry.text),
      ]),
      ...COMPARE_PAGES.flatMap((page) => [
        page.verdict,
        ...page.sections.flatMap((section) => section.paragraphs),
        ...page.facts.flatMap((fact) => [fact.gitdiagram, fact.other]),
      ]),
      ...ROUNDUP_TOOLS.map((tool) => tool.text),
    ];
    for (const href of texts.flatMap(siteLinks)) {
      const path = href.split("#")[0]!;
      // Repository pages are /owner/repo; everything else must exist.
      if (/^\/(?!compare\/)[^/]+\/[^/]+$/.test(path)) continue;
      expect(SITE_PAGES.has(path) || /\.(?:md|txt)$/.test(path), href).toBe(
        true,
      );
    }
  });

  it("the guide's first paragraph answers the question and links the comparisons", () => {
    expect(GUIDE_INTRODUCTION).toMatch(/^To visualize a GitHub repository/);
    expect(GUIDE_INTRODUCTION).toContain(ROUNDUP_PATH);
    for (const page of COMPARE_PAGES)
      expect(GUIDE_INTRODUCTION).toContain(comparePath(page.slug));
  });

  it("render as Markdown with absolute links and a source line", () => {
    for (const page of COMPARE_PAGES) {
      const markdown = comparePageMarkdown(page);
      expect(markdown.startsWith(`# ${page.title}`)).toBe(true);
      expect(markdown).toContain(
        `Source: https://gitdiagram.com${comparePath(page.slug)}`,
      );
      expect(markdown).not.toMatch(/\]\(\//);
      expect(markdown).toContain(`| | GitDiagram | ${page.tool} |`);
    }
    const roundup = roundupMarkdown();
    for (const tool of ROUNDUP_TOOLS)
      expect(roundup).toContain(`### ${tool.name}`);
    expect(roundup).not.toMatch(/\]\(\//);
  });
});
