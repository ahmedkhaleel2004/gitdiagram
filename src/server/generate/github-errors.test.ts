import { describe, expect, it } from "vitest";
import {
  classifyGitHubError,
  CommitResolutionError,
  GitHubRequestError,
} from "./github-errors";

describe("GitHub generation errors", () => {
  it.each([
    ["Repository not found.", "REPOSITORY_NOT_FOUND"],
    [
      "Could not fetch repository file tree. Repository might be empty or inaccessible.",
      "REPOSITORY_EMPTY",
    ],
    ["Could not fetch repository file tree.", "GITHUB_TREE_UNAVAILABLE"],
    ["GitHub request timed out. Please retry.", "GITHUB_TIMEOUT"],
    [
      "A GitHub token is required to analyze a private repository.",
      "GITHUB_AUTH_REQUIRED",
    ],
  ])("classifies %s without generic stream failures", (message, code) => {
    expect(classifyGitHubError(new Error(message), false)?.errorCode).toBe(
      code,
    );
  });
  it("gives personal credentials an actionable error without exposing server credential state", () => {
    const error = new GitHubRequestError(
      "GitHub request failed (401). Please retry.",
      401,
    );
    expect(classifyGitHubError(error, true)?.errorCode).toBe(
      "GITHUB_TOKEN_INVALID",
    );
    expect(classifyGitHubError(error, false)).toMatchObject({
      errorCode: "GITHUB_UNAVAILABLE",
      status: 503,
    });
    expect(classifyGitHubError(error, false)?.message).not.toContain("token");
  });
  it("distinguishes rate limiting from forbidden permissions", () => {
    expect(
      classifyGitHubError(new GitHubRequestError("Forbidden", 403, true), true)
        ?.errorCode,
    ).toBe("GITHUB_RATE_LIMITED");
    expect(
      classifyGitHubError(new GitHubRequestError("Forbidden", 403), true)
        ?.errorCode,
    ).toBe("GITHUB_ACCESS_DENIED");
  });
  it("does not relabel unrelated model or storage failures", () => {
    expect(classifyGitHubError(new Error("storage failed"), false)).toBeNull();
  });
});

describe("commit resolution errors", () => {
  it.each([
    ["invalid", "COMMIT_SHA_INVALID", 400],
    ["not_found", "COMMIT_NOT_FOUND", 404],
    ["ambiguous", "COMMIT_AMBIGUOUS", 422],
  ] as const)("maps %s to %s", (failure, errorCode, status) => {
    expect(
      classifyGitHubError(new CommitResolutionError(failure), false),
    ).toMatchObject({ errorCode, status });
  });

  it("tells the three apart in plain words", () => {
    const messages = (["invalid", "not_found", "ambiguous"] as const).map(
      (failure) =>
        classifyGitHubError(new CommitResolutionError(failure), true)?.message,
    );

    expect(new Set(messages).size).toBe(3);
    expect(messages[2]).toMatch(/more than one commit/u);
  });

  it("keeps the private-repository error distinct from a missing commit", () => {
    expect(
      classifyGitHubError(
        new Error(
          "A GitHub token is required to analyze a private repository.",
        ),
        false,
      )?.errorCode,
    ).toBe("GITHUB_AUTH_REQUIRED");
  });
});
