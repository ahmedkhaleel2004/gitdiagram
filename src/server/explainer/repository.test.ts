import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("~/server/github-auth", () => ({
  getGitHubApiHeaders: vi.fn(async () => ({})),
}));
vi.mock("~/server/generate/github", () => ({
  REPOSITORY_NOT_FOUND_ERROR: "Repository not found.",
  PRIVATE_REPOSITORY_AUTH_REQUIRED_ERROR:
    "A GitHub token is required to analyze a private repository.",
  EMPTY_REPOSITORY_ERROR: "Could not fetch repository file tree.",
  REPOSITORY_TOO_LARGE_ERROR: "Repository is too large.",
  getGithubData: vi.fn(),
}));
vi.mock("~/server/generate/source-context", () => ({
  fetchSourceContext: vi.fn(async () => ({ text: "code" })),
}));

import { getGithubData } from "~/server/generate/github";
import {
  isPublicRepository,
  readRepositoryForVideo,
  VideoInputError,
} from "./repository";

describe("isPublicRepository", () => {
  it("is true only when GitHub says the repository is public", async () => {
    const respond = (body: unknown, status = 200) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status })),
      );
    respond({ private: false });
    expect(await isPublicRepository("a", "b")).toBe(true);
    respond({ private: true });
    expect(await isPublicRepository("a", "b")).toBe(false);
    respond({}, 404);
    expect(await isPublicRepository("a", "b")).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    expect(await isPublicRepository("a", "b")).toBe(false);
  });
});

const read = () => readRepositoryForVideo({ username: "a", repo: "b" });

describe("readRepositoryForVideo", () => {
  beforeEach(() => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it.each([
    ["Repository not found."],
    ["A GitHub token is required to analyze a private repository."],
  ])(
    "explains that a repository GitDiagram cannot read must be public (%s)",
    async (message) => {
      vi.mocked(getGithubData).mockRejectedValue(new Error(message));
      await expect(read()).rejects.toBeInstanceOf(VideoInputError);
      await expect(read()).rejects.toThrow(
        "Explainer videos are available for public repositories only.",
      );
    },
  );

  it("treats an empty or oversized repository as final", async () => {
    vi.mocked(getGithubData).mockRejectedValue(
      new Error("Could not fetch repository file tree."),
    );
    await expect(read()).rejects.toThrow(/looks empty/);
    await expect(read()).rejects.toBeInstanceOf(VideoInputError);
    vi.mocked(getGithubData).mockRejectedValue(
      new Error("Repository is too large."),
    );
    await expect(read()).rejects.toBeInstanceOf(VideoInputError);
  });

  it("passes other GitHub failures through unchanged", async () => {
    vi.mocked(getGithubData).mockRejectedValue(new Error("rate limited"));
    await expect(read()).rejects.not.toBeInstanceOf(VideoInputError);
    await expect(read()).rejects.toThrow("rate limited");
  });

  it("takes display metadata from the one repository read", async () => {
    vi.mocked(getGithubData).mockResolvedValue({
      defaultBranch: "main",
      fileTree: "src/main.ts",
      readme: "# B",
      isPrivate: false,
      stargazerCount: 7,
      description: "A thing",
      language: "TypeScript",
      topics: ["cli"],
      pathTypes: new Map([["src/main.ts", "blob"]]),
    });
    const repository = await read();
    expect(repository.meta).toMatchObject({
      description: "A thing",
      stars: 7,
      language: "TypeScript",
    });
    expect(repository.prompt.topics).toEqual(["cli"]);
    // No second GET /repos/{owner}/{repo} of its own.
    expect(fetch).not.toHaveBeenCalled();
  });
});
