import { describe, expect, it } from "vitest";
import {
  repositoryMarkdownPath,
  repositoryPageDescription,
  repositoryPageTitle,
} from "./repository-page";

describe("repository page titles", () => {
  it("keeps the full title when it fits about 60 characters", () => {
    expect(repositoryPageTitle("acme", "demo")).toBe(
      "acme/demo architecture diagram: how it works | GitDiagram",
    );
  });

  it("drops the site name, then 'how it works', for longer names", () => {
    expect(repositoryPageTitle("fastapi", "fastapi")).toBe(
      "fastapi/fastapi architecture diagram: how it works",
    );
    expect(repositoryPageTitle("tiangolo-labs", "sqlmodel-xyz")).toBe(
      "tiangolo-labs/sqlmodel-xyz architecture diagram | GitDiagram",
    );
    expect(repositoryPageTitle("langchain-ai", "langchain-community")).toBe(
      "langchain-ai/langchain-community architecture diagram",
    );
  });

  it("describes a repository without a diagram plainly", () => {
    expect(repositoryPageDescription("acme", "demo", null)).toMatch(
      /^Interactive architecture diagram of acme\/demo/,
    );
  });

  it("links the lowercase Markdown twin", () => {
    expect(repositoryMarkdownPath("Acme", "Next.js")).toBe("/acme/next.js.md");
  });
});
