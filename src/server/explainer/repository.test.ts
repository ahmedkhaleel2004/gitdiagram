import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("~/server/github-auth", () => ({
  getGitHubApiHeaders: vi.fn(async () => ({})),
}));
vi.mock("~/server/generate/github", () => ({
  REPOSITORY_NOT_FOUND_ERROR: "Repository not found.",
  getGithubData: vi.fn(),
}));

import { getGithubData } from "~/server/generate/github";
import { readRepositoryForVideo, VideoInputError } from "./repository";

describe("readRepositoryForVideo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
  });

  it("explains that a repository GitDiagram cannot see must be public", async () => {
    vi.mocked(getGithubData).mockRejectedValue(
      new Error("Repository not found."),
    );
    const read = readRepositoryForVideo({ username: "a", repo: "b" });
    await expect(read).rejects.toBeInstanceOf(VideoInputError);
    await expect(read).rejects.toThrow(
      "Explainer videos are available for public repositories only.",
    );
  });

  it("passes other GitHub failures through unchanged", async () => {
    vi.mocked(getGithubData).mockRejectedValue(new Error("rate limited"));
    const read = readRepositoryForVideo({ username: "a", repo: "b" });
    await expect(read).rejects.not.toBeInstanceOf(VideoInputError);
    await expect(read).rejects.toThrow("rate limited");
  });
});
