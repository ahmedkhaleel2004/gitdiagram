import { describe, expect, it } from "vitest";

import { parseGitHubRepoUrl } from "~/features/diagram/github-url";

describe("parseGitHubRepoUrl", () => {
  it("parses valid repository urls", () => {
    expect(parseGitHubRepoUrl("https://github.com/vercel/next.js")).toEqual({
      username: "vercel",
      repo: "next.js",
    });
  });

  it("parses owner/repo shorthand", () => {
    expect(parseGitHubRepoUrl("facebook/react")).toEqual({
      username: "facebook",
      repo: "react",
    });
  });

  it("trims shorthand input before parsing", () => {
    expect(parseGitHubRepoUrl("  vercel/next.js  ")).toEqual({
      username: "vercel",
      repo: "next.js",
    });
  });

  it("returns null for invalid urls", () => {
    expect(parseGitHubRepoUrl("https://gitlab.com/vercel/next.js")).toBeNull();
    expect(parseGitHubRepoUrl("not-a-url")).toBeNull();
  });
});
