import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationSessionAudit } from "~/features/diagram/graph";
import type { DiagramArtifact } from "~/server/storage/types";

const storageMocks = vi.hoisted(() => ({
  getJsonObject: vi.fn(),
  putJsonObject: vi.fn(),
  withDistributedLock: vi.fn(
    async ({ callback }: { callback: () => Promise<unknown> }) => callback(),
  ),
}));

vi.mock("~/server/storage/r2", () => ({
  getJsonObject: storageMocks.getJsonObject,
  putJsonObject: storageMocks.putJsonObject,
  R2_REQUEST_TIMEOUT_MS: 10_000,
}));

vi.mock("~/server/storage/distributed-lock", () => ({
  withDistributedLock: storageMocks.withDistributedLock,
}));

import { writeDiagramArtifact } from "~/server/storage/artifact-store";

const graph = {
  groups: [],
  nodes: [],
  edges: [],
};

function createAudit(params: {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}): GenerationSessionAudit {
  return {
    sessionId: params.sessionId,
    status: "succeeded",
    stage: "complete",
    provider: "openai",
    model: "gpt-5.6-terra",
    graph,
    graphAttempts: [],
    stageUsages: [],
    timeline: [],
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  };
}

function createArtifact(params: {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  diagram: string;
}): DiagramArtifact {
  return {
    version: 1,
    visibility: "public",
    username: "acme",
    repo: "demo",
    stargazerCount: 42,
    diagram: params.diagram,
    explanation: `${params.diagram} explanation`,
    graph,
    generatedAt: params.updatedAt,
    usedOwnKey: false,
    latestSessionSummary: createAudit(params),
    lastSuccessfulAt: params.updatedAt,
  };
}

async function writeArtifact(artifact: DiagramArtifact) {
  return writeDiagramArtifact({
    username: artifact.username,
    repo: artifact.repo,
    visibility: artifact.visibility,
    stargazerCount: artifact.stargazerCount,
    diagram: artifact.diagram,
    explanation: artifact.explanation,
    graph: artifact.graph,
    generatedAt: artifact.generatedAt,
    usedOwnKey: artifact.usedOwnKey,
    latestSessionSummary: artifact.latestSessionSummary,
    lastSuccessfulAt: artifact.lastSuccessfulAt,
  });
}

describe("writeDiagramArtifact", () => {
  beforeEach(() => {
    process.env.R2_PUBLIC_BUCKET = "test-public-bucket";
    vi.clearAllMocks();
    storageMocks.withDistributedLock.mockImplementation(async ({ callback }) =>
      callback(),
    );
  });

  it("does not let an older session that finishes later overwrite a newer artifact", async () => {
    const newerArtifact = createArtifact({
      sessionId: "session-newer",
      createdAt: "2026-07-13T12:01:00.000Z",
      updatedAt: "2026-07-13T12:05:00.000Z",
      diagram: "newer diagram",
    });
    const olderArtifact = createArtifact({
      sessionId: "session-older",
      createdAt: "2026-07-13T12:00:00.000Z",
      updatedAt: "2026-07-13T12:10:00.000Z",
      diagram: "older diagram",
    });
    let storedArtifact: DiagramArtifact | null = null;
    let lockTail = Promise.resolve();
    storageMocks.withDistributedLock.mockImplementation(({ callback }) => {
      const result = lockTail.then(callback);
      lockTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });
    storageMocks.getJsonObject.mockImplementation(async () => storedArtifact);
    storageMocks.putJsonObject.mockImplementation(
      async (_bucket, _key, artifact: DiagramArtifact) => {
        storedArtifact = artifact;
      },
    );

    // The newer session completes first; the older, slower session reaches
    // persistence immediately afterward. Both writes target the same lock.
    const writeResults = await Promise.all([
      writeArtifact(newerArtifact),
      writeArtifact(olderArtifact),
    ]);

    expect(writeResults).toEqual([true, false]);
    expect(storageMocks.putJsonObject).toHaveBeenCalledOnce();
    expect(storedArtifact).toEqual(newerArtifact);
  });

  it("replaces an older artifact when the newer session finishes", async () => {
    const olderArtifact = createArtifact({
      sessionId: "session-older",
      createdAt: "2026-07-13T12:00:00.000Z",
      updatedAt: "2026-07-13T12:10:00.000Z",
      diagram: "older diagram",
    });
    const newerArtifact = createArtifact({
      sessionId: "session-newer",
      createdAt: "2026-07-13T12:01:00.000Z",
      updatedAt: "2026-07-13T12:05:00.000Z",
      diagram: "newer diagram",
    });
    storageMocks.getJsonObject.mockResolvedValue(olderArtifact);

    await expect(writeArtifact(newerArtifact)).resolves.toBe(true);

    expect(storageMocks.putJsonObject).toHaveBeenCalledWith(
      "test-public-bucket",
      "public/v1/acme/demo.json",
      newerArtifact,
    );
  });

  it("budgets the lock lease for the serialized R2 read and write", async () => {
    storageMocks.getJsonObject.mockResolvedValue(null);

    await writeArtifact(
      createArtifact({
        sessionId: "session-1",
        createdAt: "2026-07-13T12:00:00.000Z",
        updatedAt: "2026-07-13T12:05:00.000Z",
        diagram: "diagram",
      }),
    );

    expect(storageMocks.withDistributedLock).toHaveBeenCalledWith(
      expect.objectContaining({
        ttlMs: 45_000,
        waitMs: 30_000,
      }),
    );
  });
});
