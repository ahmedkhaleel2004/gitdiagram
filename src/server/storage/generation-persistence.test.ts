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
  notifyIndexNow: vi.fn(() => Promise.resolve()),
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
vi.mock("~/server/visibility/indexnow", () => ({
  notifyIndexNow: mocks.notifyIndexNow,
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
    const params = {
      ...baseParams(),
      visibility: "private" as const,
      githubPat: "caller-token",
    };
    await persistGenerationResult(params);
    for (const task of params.postResponseTasks) {
      await task();
    }

    expect(mocks.saveSuccessfulDiagramState).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private" }),
    );
    // A private repository's page is never announced to search engines.
    expect(mocks.notifyIndexNow).not.toHaveBeenCalled();
  });

  it("expires saved diagram data and revalidates pages for both URL casings", async () => {
    const params = { ...baseParams(), visibility: "public" as const };

    await persistGenerationResult(params);
    for (const task of params.postResponseTasks) {
      await task();
    }

    // Storage lowercases, but the route-level ISR entry is keyed on the URL as
    // requested, so a visitor at /Acme/Demo would otherwise hold stale HTML.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/acme/demo");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/Acme/Demo");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/acme/demo/opengraph-image",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/Acme/Demo/opengraph-image",
    );
    // The README picture is served only on the lowercase path.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/acme/demo/diagram.png");
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      "public-diagram-state:acme:demo",
      { expire: 0 },
    );
    // Search engines hear about the page once, at its canonical address.
    expect(mocks.notifyIndexNow).toHaveBeenCalledTimes(1);
    expect(mocks.notifyIndexNow).toHaveBeenCalledWith([
      "https://gitdiagram.com/acme/demo",
    ]);
  });

  it("revalidates each route once when the request was already normalized", async () => {
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

    expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/acme/demo");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/acme/demo/opengraph-image",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/acme/demo/diagram.png");
  });
});

describe("persistGenerationResult for a commit", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  async function run(
    overrides: Partial<Parameters<typeof persistGenerationResult>[0]> = {},
  ) {
    const params = {
      ...baseParams(),
      visibility: "public" as const,
      commit: sha,
      ...overrides,
    };
    await persistGenerationResult(params);
    for (const task of params.postResponseTasks) {
      await task();
    }
  }

  it("stores under the commit and clears only that commit's failure summary", async () => {
    await run();

    expect(mocks.saveSuccessfulDiagramState).toHaveBeenCalledWith(
      expect.objectContaining({ commit: sha, visibility: "public" }),
    );
    expect(mocks.clearSuccessfulDiagramFailureSummary).toHaveBeenCalledWith(
      expect.objectContaining({ commit: sha }),
    );
  });

  it("refreshes only the commit's page and cached read", async () => {
    await run();

    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/acme/demo/commit/${sha}`,
    );
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      `public-diagram-state:acme:demo:commit:${sha}`,
      { expire: 0 },
    );
  });

  it("leaves the default branch's preview, browse index and search pings alone", async () => {
    await run();

    expect(mocks.writePublicDiagramPreview).not.toHaveBeenCalled();
    expect(
      mocks.updatePublicBrowseIndexForSuccessfulDiagram,
    ).not.toHaveBeenCalled();
    expect(mocks.revalidateBrowseIndexCache).not.toHaveBeenCalled();
    expect(mocks.notifyIndexNow).not.toHaveBeenCalled();
  });

  it("does nothing more when the commit already had a diagram", async () => {
    mocks.saveSuccessfulDiagramState.mockResolvedValue(false);

    await run();

    expect(mocks.clearSuccessfulDiagramFailureSummary).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps a failed commit run's audit under that commit", async () => {
    await run({
      audit: { ...audit, status: "failed" as const },
      successfulDiagramState: null,
    });

    expect(mocks.persistTerminalSessionAudit).toHaveBeenCalledWith(
      expect.objectContaining({ commit: sha }),
    );
    expect(mocks.saveSuccessfulDiagramState).not.toHaveBeenCalled();
  });

  it("does not announce a private commit diagram anywhere", async () => {
    await run({ visibility: "private", githubPat: "caller-token" });

    expect(mocks.saveSuccessfulDiagramState).toHaveBeenCalledWith(
      expect.objectContaining({ commit: sha, visibility: "private" }),
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.notifyIndexNow).not.toHaveBeenCalled();
  });
});
