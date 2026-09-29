import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStoredDiagramArtifact, cacheOptions } = vi.hoisted(() => ({
  getStoredDiagramArtifact: vi.fn(),
  cacheOptions: [] as Array<{ tags: string[] }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache:
    (
      read: () => Promise<unknown>,
      _keys: string[],
      options: { tags: string[] },
    ) =>
    () => {
      cacheOptions.push(options);
      return read();
    },
}));
vi.mock("~/server/storage/artifact-store", () => ({
  getStoredDiagramArtifact,
}));

import { getDiagramPictureData } from "./diagram-picture-data";

const graph = {
  groups: [],
  nodes: [
    {
      id: "api",
      label: "API",
      type: "service",
      description: null,
      groupId: null,
      path: null,
      shape: null,
    },
  ],
  edges: [],
};

function stored(overrides: Record<string, unknown> = {}) {
  return {
    artifact: {
      visibility: "public",
      diagram: "flowchart TD",
      graph,
      stargazerCount: 7,
      ...overrides,
    },
  };
}

describe("getDiagramPictureData", () => {
  beforeEach(() => {
    getStoredDiagramArtifact.mockReset();
    cacheOptions.length = 0;
  });

  it("reads only the public namespace and tags the read with the page's tag", async () => {
    getStoredDiagramArtifact.mockResolvedValue(stored());
    await expect(getDiagramPictureData("acme", "demo")).resolves.toEqual({
      kind: "graph",
      graph,
      stargazerCount: 7,
    });
    expect(getStoredDiagramArtifact).toHaveBeenCalledWith({
      username: "acme",
      repo: "demo",
    });
    expect(cacheOptions[0]?.tags).toEqual(["public-diagram-state:acme:demo"]);
  });

  it("never draws a private diagram", async () => {
    getStoredDiagramArtifact.mockResolvedValue(
      stored({ visibility: "private" }),
    );
    await expect(getDiagramPictureData("acme", "demo")).resolves.toBeNull();
  });

  it("falls back to the repository card for diagrams without a graph", async () => {
    getStoredDiagramArtifact.mockResolvedValue(stored({ graph: null }));
    await expect(getDiagramPictureData("acme", "demo")).resolves.toEqual({
      kind: "card",
      stargazerCount: 7,
    });
  });

  it("rejects names GitHub cannot have before reading storage", async () => {
    await expect(getDiagramPictureData("../x", "demo")).resolves.toBeNull();
    await expect(getDiagramPictureData("acme", "..")).resolves.toBeNull();
    expect(getStoredDiagramArtifact).not.toHaveBeenCalled();
  });

  it("has nothing to draw before the first diagram", async () => {
    getStoredDiagramArtifact.mockResolvedValue(null);
    await expect(getDiagramPictureData("acme", "demo")).resolves.toBeNull();
  });
});
