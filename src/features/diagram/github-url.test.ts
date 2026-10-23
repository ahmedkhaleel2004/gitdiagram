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

describe("parseGitHubRepoUrl commit urls", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("reads the commit out of a GitHub commit url", () => {
    expect(
      parseGitHubRepoUrl(`https://github.com/vercel/next.js/commit/${sha}`),
    ).toEqual({ username: "vercel", repo: "next.js", commit: sha });
  });

  it("accepts a short SHA, a www host and a trailing slash", () => {
    expect(
      parseGitHubRepoUrl("https://www.github.com/acme/demo/commit/0123abc/"),
    ).toEqual({ username: "acme", repo: "demo", commit: "0123abc" });
  });

  it("ignores what follows the SHA", () => {
    for (const suffix of [
      "/files",
      "?diff=split",
      "#diff-abc",
      "/checks?x=1",
    ]) {
      expect(
        parseGitHubRepoUrl(
          `https://github.com/acme/demo/commit/${sha}${suffix}`,
        ),
      ).toEqual({ username: "acme", repo: "demo", commit: sha });
    }
  });

  it("hands the SHA back as written, for the caller to validate", () => {
    expect(
      parseGitHubRepoUrl("https://github.com/acme/demo/commit/not-a-sha"),
    ).toEqual({ username: "acme", repo: "demo", commit: "not-a-sha" });
  });

  it("strips .git from the repository of a commit url", () => {
    expect(
      parseGitHubRepoUrl(`https://github.com/acme/demo.git/commit/${sha}`),
    ).toEqual({ username: "acme", repo: "demo", commit: sha });
  });

  it("does not report a commit for other repository pages", () => {
    for (const url of [
      "https://github.com/acme/demo/commits/main",
      "https://github.com/acme/demo/commit",
      "https://github.com/acme/demo/commit/",
      "https://github.com/acme/demo/tree/main/commit/abc1234",
      "https://github.com/acme/demo/pull/1/commits/abc1234",
      "https://github.com/acme/demo",
      "acme/demo",
      "git@github.com:acme/demo.git",
    ]) {
      expect(parseGitHubRepoUrl(url)).not.toHaveProperty("commit");
    }
  });
});
