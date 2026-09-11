import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStoredDiagramArtifact } = vi.hoisted(() => ({
  getStoredDiagramArtifact: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/storage/artifact-store", () => ({
  getStoredDiagramArtifact,
}));

import { getRepoSocialMetadata } from "~/server/og/repo-metadata";

function storedArtifact(visibility: "public" | "private" = "public") {
  return {
    artifact: {
      version: 1,
      visibility,
      username: "owner",
      repo: "repo",
      stargazerCount: 42,
    },
    location: {
      visibility,
      bucket: "bucket",
      artifactKey: "artifact",
      statusKey: "status",
    },
  };
}

describe("getRepoSocialMetadata", () => {
  beforeEach(() => {
    getStoredDiagramArtifact.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses only metadata already stored for a generated public diagram", async () => {
    getStoredDiagramArtifact.mockResolvedValue(storedArtifact());

    await expect(getRepoSocialMetadata("owner", "repo")).resolves.toEqual({
      defaultBranch: null,
      isPrivate: false,
      language: null,
      stargazerCount: 42,
    });
    expect(getStoredDiagramArtifact).toHaveBeenCalledWith({
      username: "owner",
      repo: "repo",
    });
  });

  it("rejects malformed route segments before touching storage", async () => {
    await expect(
      getRepoSocialMetadata("owner name", "repo/name"),
    ).resolves.toBeNull();
    expect(getStoredDiagramArtifact).not.toHaveBeenCalled();
  });

  it("returns no image metadata when a public artifact is missing", async () => {
    getStoredDiagramArtifact.mockResolvedValue(null);

    await expect(getRepoSocialMetadata("owner", "missing")).resolves.toBeNull();
  });

  it("does not expose private artifact metadata", async () => {
    getStoredDiagramArtifact.mockResolvedValue(storedArtifact("private"));

    await expect(getRepoSocialMetadata("owner", "private")).resolves.toBeNull();
  });

  it("records storage failures while returning no metadata", async () => {
    getStoredDiagramArtifact.mockRejectedValue(new Error("R2 unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(getRepoSocialMetadata("owner", "repo")).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("og.repo_metadata.fetch_failed"),
    );
  });
});
