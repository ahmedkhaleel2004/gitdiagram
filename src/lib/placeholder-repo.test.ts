import { describe, expect, it } from "vitest";

import { isPlaceholderRepo } from "./placeholder-repo";

describe("isPlaceholderRepo", () => {
  it.each([
    ["user", "repo"],
    ["owner", "repo"],
    ["owner", "project"],
    ["owner", "repository"],
    ["user", "repository"],
    ["username", "repo"],
    ["your-username", "your-repository"],
    ["your-username", "your-repo"],
    ["User", "Repo"],
    ["%3Cuser%3E", "%3Crepo%3E"],
    ["{owner}", "{repo}"],
    [":owner", ":repo"],
  ])("treats /%s/%s as a copied placeholder", (username, repo) => {
    expect(isPlaceholderRepo(username, repo)).toBe(true);
  });

  it.each([
    ["fastapi", "fastapi"],
    ["user", "fastapi"],
    ["facebook", "repo"],
    ["github", "spec-kit"],
    ["userland", "repo"],
  ])("leaves the real-looking /%s/%s alone", (username, repo) => {
    expect(isPlaceholderRepo(username, repo)).toBe(false);
  });

  it("does not throw on a malformed escape", () => {
    expect(isPlaceholderRepo("%E0%A4%A", "repo")).toBe(false);
  });
});
