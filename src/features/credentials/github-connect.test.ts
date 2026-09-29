import { describe, expect, it } from "vitest";

import {
  githubConnectUrl,
  parseGitHubConnectResult,
  withoutGitHubConnectResult,
} from "./github-connect";

describe("GitHub connect client helpers", () => {
  it("builds the sign-in URL for each entry point", () => {
    expect(githubConnectUrl({ repository: "o/r", source: "repo" })).toBe(
      "/api/github/connect?repo=o%2Fr",
    );
    expect(githubConnectUrl({ source: "menu", returnTo: "/videos?x=1" })).toBe(
      "/api/github/connect?from=menu&return=%2Fvideos%3Fx%3D1",
    );
    expect(
      githubConnectUrl({ repository: "o/r", source: "repo", install: true }),
    ).toBe("/api/github/connect?repo=o%2Fr&install=1");
  });

  it("reads the outcome and who it is for", () => {
    expect(parseGitHubConnectResult("")).toBeNull();
    expect(parseGitHubConnectResult("?github=connected")).toEqual({
      status: "connected",
      source: "repo",
    });
    expect(
      parseGitHubConnectResult("?github=no_access&github_from=menu"),
    ).toEqual({ status: "failed", reason: "no_access", source: "menu" });
    expect(parseGitHubConnectResult("?github=<script>")).toEqual({
      status: "failed",
      reason: "error",
      source: "repo",
    });
    expect(parseGitHubConnectResult("?github=toString")).toMatchObject({
      reason: "error",
    });
  });

  it("strips only the outcome from the address", () => {
    expect(
      withoutGitHubConnectResult(
        "https://gitdiagram.com/o/r?tab=video&github=connected&github_from=menu#top",
      ),
    ).toBe("/o/r?tab=video#top");
  });
});
