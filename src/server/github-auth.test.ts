// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { readGitHubPatPool } from "~/server/github-auth";

const originalGithubPat = process.env.GITHUB_PAT;
const originalGithubPats = process.env.GITHUB_PATS;

afterEach(() => {
  if (originalGithubPat === undefined) delete process.env.GITHUB_PAT;
  else process.env.GITHUB_PAT = originalGithubPat;
  if (originalGithubPats === undefined) delete process.env.GITHUB_PATS;
  else process.env.GITHUB_PATS = originalGithubPats;
});

describe("readGitHubPatPool", () => {
  it("uses a standalone GITHUB_PAT and deduplicates pooled tokens", () => {
    process.env.GITHUB_PAT = "single";
    process.env.GITHUB_PATS = "pooled, single\npooled";

    expect(readGitHubPatPool()).toEqual(["pooled", "single"]);
  });

  it("does not drop GITHUB_PAT when GITHUB_PATS is unset", () => {
    process.env.GITHUB_PAT = "single";
    delete process.env.GITHUB_PATS;

    expect(readGitHubPatPool()).toEqual(["single"]);
  });
});
