import { describe, expect, it } from "vitest";

import {
  commitErrorTitle,
  githubCommitUrl,
  isFullCommitSha,
  parseCommitSha,
  shortCommitSha,
} from "~/features/diagram/commit";

const FULL = "0123456789abcdef0123456789abcdef01234567";

describe("parseCommitSha", () => {
  it("accepts a full 40-character SHA", () => {
    expect(parseCommitSha(FULL)).toEqual({ sha: FULL, full: true });
  });

  it("accepts a short SHA from 7 to 39 characters", () => {
    expect(parseCommitSha(FULL.slice(0, 7))).toEqual({
      sha: FULL.slice(0, 7),
      full: false,
    });
    expect(parseCommitSha(FULL.slice(0, 39))).toEqual({
      sha: FULL.slice(0, 39),
      full: false,
    });
  });

  it("trims whitespace and lowercases", () => {
    expect(parseCommitSha(`  ${FULL.slice(0, 10).toUpperCase()}\n`)).toEqual({
      sha: FULL.slice(0, 10),
      full: false,
    });
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["too short", "abc123"],
    ["too long", `${FULL}0`],
    ["non-hexadecimal", "g123456"],
    ["a branch name", "main"],
    ["a hexadecimal-looking word with a dash", "dead-beef"],
    ["a revision expression", "HEAD~1"],
    ["an expression on a SHA", `${FULL.slice(0, 7)}~1`],
    ["a path", `../${FULL}`],
    ["inner whitespace", "0123456 89"],
  ])("rejects %s", (_name, input) => {
    expect(parseCommitSha(input)).toBeNull();
  });
});

describe("commit helpers", () => {
  it("tells a full SHA from anything else", () => {
    expect(isFullCommitSha(FULL)).toBe(true);
    expect(isFullCommitSha(FULL.slice(0, 7))).toBe(false);
    expect(isFullCommitSha(FULL.toUpperCase())).toBe(false);
  });

  it("shortens to 7 characters", () => {
    expect(shortCommitSha(FULL)).toBe("0123456");
    expect(shortCommitSha("abc")).toBe("abc");
  });

  it("links to the commit on GitHub", () => {
    expect(githubCommitUrl("acme/demo", FULL)).toBe(
      `https://github.com/acme/demo/commit/${FULL}`,
    );
  });

  it("titles only the commit errors", () => {
    expect(commitErrorTitle("COMMIT_NOT_FOUND")).toMatch(/commit/u);
    expect(commitErrorTitle("COMMIT_AMBIGUOUS")).toMatch(/several/u);
    expect(commitErrorTitle("COMMIT_SHA_INVALID")).toMatch(/SHA/u);
    expect(commitErrorTitle("GITHUB_AUTH_REQUIRED")).toBeUndefined();
    expect(commitErrorTitle("toString")).toBeUndefined();
    expect(commitErrorTitle(undefined)).toBeUndefined();
  });
});
