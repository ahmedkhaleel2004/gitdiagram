import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ArtifactStoreModule from "~/server/storage/artifact-store";

const { writeDiagramArtifact, clearFailureSummary, upsertBrowseIndexEntry } =
  vi.hoisted(() => ({
    writeDiagramArtifact: vi.fn(),
    clearFailureSummary: vi.fn(),
    upsertBrowseIndexEntry: vi.fn(),
  }));

vi.mock("~/server/storage/artifact-store", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ArtifactStoreModule;

  return {
    ...actual,
    writeDiagramArtifact,
  };
});

vi.mock("~/server/storage/status-store", () => ({
  clearFailureSummary,
}));

vi.mock("~/server/storage/browse-diagrams", () => ({
  upsertBrowseIndexEntry,
}));

import {
  saveSuccessfulDiagramState,
  updatePublicBrowseIndexForSuccessfulDiagram,
} from "~/server/storage/diagram-state";

const baseAudit = {
  sessionId: "session-1",
  status: "succeeded" as const,
  stage: "complete",
  provider: "openai",
  model: "gpt-5.4-mini",
  graph: {
    groups: [],
    nodes: [],
    edges: [],
  },
  graphAttempts: [],
  stageUsages: [],
  timeline: [],
  createdAt: "2026-03-29T12:00:00.000Z",
  updatedAt: "2026-03-29T12:00:00.000Z",
};

describe("saveSuccessfulDiagramState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the public artifact without updating the browse index inline", async () => {
    await saveSuccessfulDiagramState({
      username: "Acme",
      repo: "Demo",
      visibility: "public",
      stargazerCount: 42,
      explanation: "Explanation",
      graph: {
        groups: [],
        nodes: [],
        edges: [],
      },
      diagram: "flowchart TD\nA-->B",
      audit: baseAudit,
      usedOwnKey: false,
    });

    expect(writeDiagramArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        stargazerCount: 42,
      }),
    );
    expect(upsertBrowseIndexEntry).not.toHaveBeenCalled();
  });

  it("updates the public browse index when scheduled separately", async () => {
    await updatePublicBrowseIndexForSuccessfulDiagram({
      username: "Acme",
      repo: "Demo",
      lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
      stargazerCount: 42,
    });

    expect(upsertBrowseIndexEntry).toHaveBeenCalledWith({
      username: "Acme",
      repo: "Demo",
      lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
      stargazerCount: 42,
    });
  });

  it("does not update the public browse index for private artifacts", async () => {
    await saveSuccessfulDiagramState({
      username: "Acme",
      repo: "Demo",
      githubPat: "ghp_private",
      visibility: "private",
      stargazerCount: 42,
      explanation: "Explanation",
      graph: {
        groups: [],
        nodes: [],
        edges: [],
      },
      diagram: "flowchart TD\nA-->B",
      audit: baseAudit,
      usedOwnKey: false,
    });

    expect(upsertBrowseIndexEntry).not.toHaveBeenCalled();
  });
});
