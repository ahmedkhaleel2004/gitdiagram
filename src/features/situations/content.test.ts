import { describe, expect, it } from "vitest";
import {
  COMPARE_PAGES,
  ROUNDUP_PATH,
  comparePath,
} from "~/features/compare/content";
import { guideSections } from "~/features/guide/content";
import { llmsFullText, llmsText } from "~/features/guide/llms";
import { SITUATION_PAGES, diagramPicturePath, situationPath } from "./content";
import { situationMarkdown } from "./markdown";
import { SITUATION_SLUGS, isUnknownGuidePath } from "./slugs";

const SITE_PAGES = new Set([
  "/",
  "/visualize-codebase",
  "/browse",
  "/videos",
  "/privacy",
  ROUNDUP_PATH,
  ...COMPARE_PAGES.map((page) => comparePath(page.slug)),
  ...SITUATION_PAGES.map((page) => situationPath(page.slug)),
]);

function texts(page: (typeof SITUATION_PAGES)[number]): string[] {
  return [
    page.answer,
    ...page.steps.map((step) => step.text),
    ...page.example.paragraphs,
    ...page.sections.flatMap((section) => section.paragraphs),
    ...page.questions.map((question) => question.answer),
  ];
}

describe("situation guides", () => {
  it("match the slugs the Worker's firewall knows", () => {
    expect(SITUATION_PAGES.map((page) => page.slug)).toEqual([
      ...SITUATION_SLUGS,
    ]);
    expect(isUnknownGuidePath("/guides/legacy-codebase")).toBe(false);
    expect(isUnknownGuidePath("/guides/legacy-codebase.md")).toBe(false);
    expect(isUnknownGuidePath("/guides/nope")).toBe(true);
    expect(isUnknownGuidePath("/compare/nope")).toBe(false);
  });

  it("fit a search result, with unique titles", () => {
    for (const page of SITUATION_PAGES) {
      expect(page.metaTitle.length).toBeLessThanOrEqual(60);
      expect(page.description.length).toBeLessThanOrEqual(200);
    }
    expect(new Set(SITUATION_PAGES.map((page) => page.title)).size).toBe(
      SITUATION_PAGES.length,
    );
  });

  it("answer first, give a workflow, a real example and sources", () => {
    for (const page of SITUATION_PAGES) {
      expect(page.answer.length).toBeGreaterThan(200);
      expect(page.steps.length).toBeGreaterThanOrEqual(4);
      expect(page.sources.length).toBeGreaterThanOrEqual(3);
      for (const source of page.sources)
        expect(source.url).toMatch(/^https:\/\//);
      // The example is a stored diagram on this site, linked from its text.
      expect(page.example.repo).toMatch(/^[a-z0-9._-]+\/[a-z0-9._-]+$/);
      expect(page.example.paragraphs.join(" ")).toContain(
        `](/${page.example.repo})`,
      );
      expect(diagramPicturePath(page.example.repo)).toBe(
        `/${page.example.repo}/diagram.png`,
      );
    }
  });

  it("are not near-duplicates: every example and first answer differs", () => {
    expect(new Set(SITUATION_PAGES.map((p) => p.example.repo)).size).toBe(
      SITUATION_PAGES.length,
    );
    expect(new Set(SITUATION_PAGES.map((p) => p.answer)).size).toBe(
      SITUATION_PAGES.length,
    );
  });

  it("link only to pages this site has (repositories aside)", () => {
    for (const page of SITUATION_PAGES)
      for (const text of texts(page))
        for (const [, href] of text.matchAll(/\]\((\/[^)]*)\)/g)) {
          const path = href!.split("#")[0]!;
          if (/^\/(?!compare\/|guides\/)[^/]+\/[^/]+$/.test(path)) continue;
          expect(SITE_PAGES.has(path), href).toBe(true);
        }
  });

  it("render as Markdown with absolute links, the picture and sources", () => {
    for (const page of SITUATION_PAGES) {
      const markdown = situationMarkdown(page);
      expect(markdown.startsWith(`# ${page.title}`)).toBe(true);
      expect(markdown).toContain(
        `Source: https://gitdiagram.com${situationPath(page.slug)}`,
      );
      expect(markdown).toContain(
        `https://gitdiagram.com/${page.example.repo}/diagram.png`,
      );
      expect(markdown).not.toMatch(/\]\(\//);
      for (const source of page.sources) expect(markdown).toContain(source.url);
    }
  });

  it("are listed in llms.txt, llms-full.txt and the guide", () => {
    const short = llmsText({ videos: true });
    const full = llmsFullText({ videos: true });
    const guide = guideSections({ videos: true }).find(
      (section) => section.id === "situations",
    );
    for (const page of SITUATION_PAGES) {
      const url = `https://gitdiagram.com${situationPath(page.slug)}`;
      expect(short).toContain(`(${url})`);
      expect(full).toContain(`## ${page.title}`);
      expect(
        guide?.entries?.some((entry) =>
          entry.text.includes(situationPath(page.slug)),
        ),
      ).toBe(true);
    }
  });
});
