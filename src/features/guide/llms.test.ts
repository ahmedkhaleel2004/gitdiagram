import { describe, expect, it } from "vitest";
import { GUIDE_QUESTIONS, guideSections } from "./content";
import { llmsFullText, llmsText } from "./llms";

describe("llms.txt", () => {
  it("follows the llmstxt.org shape: title, summary, then link sections", () => {
    const text = llmsText({ videos: true });
    const lines = text.split("\n");

    expect(lines[0]).toBe("# GitDiagram");
    expect(lines[2]!.startsWith("> ")).toBe(true);
    expect(text).toContain(
      "https://github.com/{owner}/{repo} becomes https://gitdiagram.com/{owner}/{repo}",
    );
    for (const heading of [
      "## For agents",
      "## Docs",
      "## Examples",
      "## Optional",
    ])
      expect(lines).toContain(heading);
    // Every list item in a section is a Markdown link.
    const items = lines.filter((line) => line.startsWith("- "));
    expect(items.length).toBeGreaterThan(8);
    for (const item of items) expect(item).toMatch(/^- \[[^\]]+\]\(https:\/\//);
  });

  it("names the agent surfaces: Markdown twin, MCP and the guide", () => {
    const text = llmsText({ videos: false });
    expect(text).toContain("https://gitdiagram.com/{owner}/{repo}.md");
    expect(text).toContain("Accept: text/markdown");
    expect(text).toContain("https://gitdiagram.com/mcp");
    expect(text).toContain("https://gitdiagram.com/visualize-codebase");
    expect(text).not.toContain("/videos");
  });

  it("adds the whole guide, questions included, to llms-full.txt", () => {
    const full = llmsFullText({ videos: true });
    expect(full.startsWith(llmsText({ videos: true }).trimEnd())).toBe(true);
    for (const section of guideSections({ videos: true }))
      expect(full).toContain(`### ${section.heading}`);
    for (const { question } of GUIDE_QUESTIONS)
      expect(full).toContain(`#### ${question}`);
    // Site links become absolute for readers outside the site.
    expect(full).toContain("[FastAPI](https://gitdiagram.com/fastapi/fastapi)");
    expect(full).not.toMatch(/\]\(\//);
  });
});
