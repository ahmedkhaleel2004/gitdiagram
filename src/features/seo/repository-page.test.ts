import { describe, expect, it } from "vitest";
import {
  repositoryMarkdownPath,
  repositoryPageDescription,
  repositoryPageTitle,
} from "./repository-page";

describe("repository page titles", () => {
  it("leads with the repository name and how it is structured", () => {
    expect(repositoryPageTitle("denoland", "deno")).toBe(
      "deno architecture diagram: how denoland/deno is structured",
    );
  });

  it("shortens to fit about 60 characters", () => {
    expect(repositoryPageTitle("microsoft", "vscode")).toBe(
      "vscode architecture diagram: how microsoft/vscode works",
    );
    expect(repositoryPageTitle("huggingface", "transformers")).toBe(
      "transformers architecture diagram (huggingface/transformers)",
    );
    expect(repositoryPageTitle("langchain-ai", "langchain-community")).toBe(
      "langchain-ai/langchain-community architecture diagram",
    );
    for (const [owner, repo] of [
      ["denoland", "deno"],
      ["microsoft", "vscode"],
      ["huggingface", "transformers"],
    ] as const) {
      expect(repositoryPageTitle(owner, repo).length).toBeLessThanOrEqual(60);
    }
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
