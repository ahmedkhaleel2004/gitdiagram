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

  it("strips a trailing .git from https clone urls", () => {
    expect(parseGitHubRepoUrl("https://github.com/vercel/next.js.git")).toEqual(
      {
        username: "vercel",
        repo: "next.js",
      },
    );
  });

  it("strips a trailing .git from owner/repo shorthand", () => {
    expect(parseGitHubRepoUrl("vercel/next.js.git")).toEqual({
      username: "vercel",
      repo: "next.js",
    });
  });

  it("strips only the final .git suffix", () => {
    expect(parseGitHubRepoUrl("owner/x.git.git")).toEqual({
      username: "owner",
      repo: "x.git",
    });
  });

  it("keeps a repo whose entire name is .git", () => {
    expect(parseGitHubRepoUrl("owner/.git")).toEqual({
      username: "owner",
      repo: ".git",
    });
  });

  it("keeps a repo named git", () => {
    expect(parseGitHubRepoUrl("owner/git")).toEqual({
      username: "owner",
      repo: "git",
    });
  });

  it("accepts uppercase scheme and host", () => {
    expect(parseGitHubRepoUrl("HTTPS://GitHub.com/vercel/next.js")).toEqual({
      username: "vercel",
      repo: "next.js",
    });
  });

  it("returns null for invalid urls", () => {
    expect(parseGitHubRepoUrl("https://gitlab.com/vercel/next.js")).toBeNull();
    expect(parseGitHubRepoUrl("not-a-url")).toBeNull();
  });
});

describe("parseGitHubRepoUrl deep links", () => {
  it.each([
    "https://github.com/vercel/next.js/",
    "https://github.com/vercel/next.js/tree/canary/packages/next",
    "https://github.com/vercel/next.js/blob/canary/README.md",
    "https://github.com/vercel/next.js/issues/123",
    "https://github.com/vercel/next.js/pull/456/files",
    "https://github.com/vercel/next.js?tab=readme-ov-file",
    "https://github.com/vercel/next.js#readme",
    "https://github.com/vercel/next.js.git/tree/canary",
    "https://www.github.com/vercel/next.js",
  ])("resolves %s to the repository", (input) => {
    expect(parseGitHubRepoUrl(input)).toEqual({
      username: "vercel",
      repo: "next.js",
    });
  });

  it("parses ssh clone urls", () => {
    expect(parseGitHubRepoUrl("git@github.com:vercel/next.js.git")).toEqual({
      username: "vercel",
      repo: "next.js",
    });
    expect(parseGitHubRepoUrl("ssh://git@github.com/vercel/next.js")).toEqual({
      username: "vercel",
      repo: "next.js",
    });
  });

  it("still rejects urls without a repository segment", () => {
    expect(parseGitHubRepoUrl("https://github.com/vercel")).toBeNull();
    expect(parseGitHubRepoUrl("https://github.com/")).toBeNull();
    expect(parseGitHubRepoUrl("https://github.com/vercel//next.js")).toBeNull();
  });
});
