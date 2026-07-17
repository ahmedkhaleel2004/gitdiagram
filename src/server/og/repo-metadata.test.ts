import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("~/server/github-auth", () => ({
  getGitHubApiHeaders: vi.fn().mockResolvedValue({
    Accept: "application/vnd.github+json",
  }),
}));

import { getRepoSocialMetadata } from "~/server/og/repo-metadata";

describe("getRepoSocialMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns GitHub metadata and encodes repository path segments", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          default_branch: "main",
          private: false,
          language: "TypeScript",
          stargazers_count: 42,
        }),
        { status: 200 },
      ),
    );

    await expect(
      getRepoSocialMetadata("owner name", "repo/name"),
    ).resolves.toEqual({
      defaultBranch: "main",
      isPrivate: false,
      language: "TypeScript",
      stargazerCount: 42,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner%20name/repo%2Fname",
      expect.any(Object),
    );
  });

  it("silently uses fallback metadata for missing repositories", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(getRepoSocialMetadata("owner", "missing")).resolves.toEqual({
      defaultBranch: null,
      isPrivate: null,
      language: null,
      stargazerCount: null,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("records upstream failures as warnings while preserving the fallback card", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 503 }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(getRepoSocialMetadata("owner", "repo")).resolves.toEqual({
      defaultBranch: null,
      isPrivate: null,
      language: null,
      stargazerCount: null,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "og.repo_metadata.fetch_failed",
        status: 503,
      }),
    );
  });
});
