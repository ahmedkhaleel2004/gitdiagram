// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveSuccessfulDiagramState: vi.fn(),
  persistTerminalSessionAudit: vi.fn(),
  clearSuccessfulDiagramFailureSummary: vi.fn(),
  updatePublicBrowseIndexForSuccessfulDiagram: vi.fn(),
  writePublicDiagramPreview: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  revalidateBrowseIndexCache: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
}));
vi.mock("~/server/browse-index-cache", () => ({
  revalidateBrowseIndexCache: mocks.revalidateBrowseIndexCache,
}));
vi.mock("~/server/storage/diagram-state", () => ({
  saveSuccessfulDiagramState: mocks.saveSuccessfulDiagramState,
  persistTerminalSessionAudit: mocks.persistTerminalSessionAudit,
  clearSuccessfulDiagramFailureSummary:
    mocks.clearSuccessfulDiagramFailureSummary,
  updatePublicBrowseIndexForSuccessfulDiagram:
    mocks.updatePublicBrowseIndexForSuccessfulDiagram,
}));
vi.mock("~/server/storage/artifact-store", () => ({
  writePublicDiagramPreview: mocks.writePublicDiagramPreview,
}));

import { persistGenerationResult } from "~/server/storage/generation-persistence";

const audit = {
  sessionId: "session-1",
  status: "succeeded" as const,
  stage: "complete",
  provider: "openai",
  model: "gpt-5.6-terra",
  graph: null,
  graphAttempts: [],
  stageUsages: [],
  timeline: [],
  createdAt: "2026-07-16T07:00:00.000Z",
  updatedAt: "2026-07-16T07:00:00.000Z",
};

const successfulDiagramState = {
  stargazerCount: 3,
  explanation: "explanation",
  graph: { groups: [], nodes: [], edges: [] },
  diagram: "flowchart TD",
};

function baseParams() {
  return {
    username: "Acme",
    repo: "Demo",
    audit,
    successfulDiagramState,
    usedOwnKey: false,
    postResponseTasks: [] as Array<() => Promise<void>>,
    recordTiming: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveSuccessfulDiagramState.mockResolvedValue(true);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("persistGenerationResult", () => {
  it("skips a private repository the caller did not authenticate for", async () => {
    // The server's own GitHub credential can reach private repositories. The
    // public bucket would expose the result and the private bucket is keyed by
    // the caller's token, so there is no destination at all.
    const warning = await persistGenerationResult({
      ...baseParams(),
      visibility: "private",
      githubPat: undefined,
    });

    expect(mocks.saveSuccessfulDiagramState).not.toHaveBeenCalled();
    expect(mocks.persistTerminalSessionAudit).not.toHaveBeenCalled();
    expect(warning).toMatch(/cannot be cached/u);
  });

  it("persists a private repository when the caller supplied a token", async () => {
    await persistGenerationResult({
      ...baseParams(),
      visibility: "private",
      githubPat: "caller-token",
    });

    expect(mocks.saveSuccessfulDiagramState).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private" }),
    );
  });

  it("revalidates both the normalized and the requested page path", async () => {
    const params = { ...baseParams(), visibility: "public" as const };

    await persistGenerationResult(params);
    for (const task of params.postResponseTasks) {
      await task();
    }

    // Storage lowercases, but the route-level ISR entry is keyed on the URL as
    // requested, so a visitor at /Acme/Demo would otherwise hold stale HTML.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/acme/demo");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/Acme/Demo");
  });

  it("revalidates a single path when the request was already normalized", async () => {
    const params = {
      ...baseParams(),
      username: "acme",
      repo: "demo",
      visibility: "public" as const,
    };

    await persistGenerationResult(params);
    for (const task of params.postResponseTasks) {
      await task();
    }

    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/acme/demo");
  });
});
