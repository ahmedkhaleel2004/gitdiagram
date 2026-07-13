import { createHash } from "node:crypto";

import type { DiagramStateResponse } from "~/features/diagram/types";
import type { GenerationSessionAudit } from "~/features/diagram/graph";
import {
  getPrivateLocation,
  getReadLocations,
  getPublicLocation,
  type StorageLocation,
} from "~/server/storage/cache-key";
import {
  getJsonObject,
  putJsonObject,
  R2_REQUEST_TIMEOUT_MS,
} from "~/server/storage/r2";
import { withDistributedLock } from "~/server/storage/distributed-lock";
import type {
  ArtifactVisibility,
  DiagramArtifact,
} from "~/server/storage/types";

// Artifact replacement performs a serialized R2 read and write. Keep the
// lease comfortably above both request timeout budgets, and let contenders
// wait long enough for one normal replacement to finish.
const ARTIFACT_LOCK_TTL_MS = R2_REQUEST_TIMEOUT_MS * 2 + 25_000;
const ARTIFACT_LOCK_WAIT_MS = R2_REQUEST_TIMEOUT_MS * 2 + 10_000;

export function toStoredSessionSummary(
  audit: GenerationSessionAudit,
): GenerationSessionAudit {
  return {
    sessionId: audit.sessionId,
    status: audit.status,
    stage: audit.stage,
    provider: audit.provider,
    model: audit.model,
    quotaStatus: audit.quotaStatus,
    quotaBucket: audit.quotaBucket,
    quotaDateUtc: audit.quotaDateUtc,
    actualCommittedTokens: audit.actualCommittedTokens,
    quotaResetAt: audit.quotaResetAt,
    estimatedCost: audit.estimatedCost,
    finalCost: audit.finalCost,
    graph: audit.graph,
    graphAttempts: audit.status === "failed" ? audit.graphAttempts : [],
    stageUsages: [],
    validationError: audit.validationError,
    failureStage: audit.failureStage,
    compilerError: audit.compilerError,
    renderError: audit.renderError,
    timeline: [],
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
  };
}

function getArtifactLockKey(location: StorageLocation): string {
  const digest = createHash("sha256")
    .update(`${location.bucket}:${location.artifactKey}`)
    .digest("hex");
  return `lock:v1:artifact:${digest}`;
}

function shouldReplaceSessionSummary(
  current: GenerationSessionAudit,
  incoming: GenerationSessionAudit,
): boolean {
  const sameSession = current.sessionId === incoming.sessionId;
  const currentTimestamp = Date.parse(
    sameSession ? current.updatedAt : current.createdAt,
  );
  const incomingTimestamp = Date.parse(
    sameSession ? incoming.updatedAt : incoming.createdAt,
  );

  if (!Number.isFinite(incomingTimestamp)) {
    return false;
  }
  if (!Number.isFinite(currentTimestamp)) {
    return true;
  }
  if (incomingTimestamp !== currentTimestamp) {
    return incomingTimestamp > currentTimestamp;
  }

  return sameSession || incoming.sessionId > current.sessionId;
}

function toDiagramStateResponse(
  artifact: DiagramArtifact,
): DiagramStateResponse {
  return {
    diagram: artifact.diagram,
    explanation: artifact.explanation,
    graph: artifact.graph,
    latestSessionAudit: artifact.latestSessionSummary,
    lastSuccessfulAt: artifact.lastSuccessfulAt,
  };
}

async function getArtifactForLocation(
  location: StorageLocation,
): Promise<DiagramArtifact | null> {
  return getJsonObject<DiagramArtifact>(location.bucket, location.artifactKey);
}

export async function getStoredDiagramArtifact(params: {
  username: string;
  repo: string;
  githubPat?: string;
}): Promise<{
  artifact: DiagramArtifact;
  location: StorageLocation;
} | null> {
  for (const location of getReadLocations(params)) {
    const artifact = await getArtifactForLocation(location);
    if (artifact) {
      return { artifact, location };
    }
  }

  return null;
}

export async function getStoredDiagramState(params: {
  username: string;
  repo: string;
  githubPat?: string;
}): Promise<DiagramStateResponse | null> {
  const result = await getStoredDiagramArtifact(params);
  if (!result) {
    return null;
  }

  return toDiagramStateResponse(result.artifact);
}

export async function getPublicDiagramPreview(params: {
  username: string;
  repo: string;
}): Promise<{
  diagram: string;
  lastSuccessfulAt: string;
} | null> {
  const artifact = await getArtifactForLocation(
    getPublicLocation(params.username, params.repo),
  );
  if (!artifact?.diagram) {
    return null;
  }

  return {
    diagram: artifact.diagram,
    lastSuccessfulAt: artifact.lastSuccessfulAt,
  };
}

export async function writeDiagramArtifact(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  stargazerCount: number | null;
  diagram: string;
  explanation: string;
  graph: GenerationSessionAudit["graph"];
  generatedAt: string;
  usedOwnKey: boolean;
  latestSessionSummary: GenerationSessionAudit;
  lastSuccessfulAt: string;
}): Promise<boolean> {
  const location =
    params.visibility === "private"
      ? getPrivateLocation(params.username, params.repo, params.githubPat ?? "")
      : getPublicLocation(params.username, params.repo);

  const artifact: DiagramArtifact = {
    version: 1,
    visibility: params.visibility,
    username: params.username,
    repo: params.repo,
    stargazerCount: params.stargazerCount,
    diagram: params.diagram,
    explanation: params.explanation,
    graph: params.graph,
    generatedAt: params.generatedAt,
    usedOwnKey: params.usedOwnKey,
    latestSessionSummary: params.latestSessionSummary,
    lastSuccessfulAt: params.lastSuccessfulAt,
  };

  return withDistributedLock({
    key: getArtifactLockKey(location),
    ttlMs: ARTIFACT_LOCK_TTL_MS,
    waitMs: ARTIFACT_LOCK_WAIT_MS,
    callback: async () => {
      const currentArtifact = await getArtifactForLocation(location);
      if (
        currentArtifact &&
        !shouldReplaceSessionSummary(
          currentArtifact.latestSessionSummary,
          artifact.latestSessionSummary,
        )
      ) {
        return false;
      }

      await putJsonObject(location.bucket, location.artifactKey, artifact);
      return true;
    },
  });
}

export async function updateArtifactLatestSessionSummary(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  latestSessionSummary: GenerationSessionAudit;
}): Promise<boolean> {
  const location =
    params.visibility === "private"
      ? getPrivateLocation(params.username, params.repo, params.githubPat ?? "")
      : getPublicLocation(params.username, params.repo);

  return withDistributedLock({
    key: getArtifactLockKey(location),
    ttlMs: ARTIFACT_LOCK_TTL_MS,
    waitMs: ARTIFACT_LOCK_WAIT_MS,
    callback: async () => {
      const artifact = await getArtifactForLocation(location);
      if (!artifact) {
        return false;
      }

      if (
        !shouldReplaceSessionSummary(
          artifact.latestSessionSummary,
          params.latestSessionSummary,
        )
      ) {
        return true;
      }

      await putJsonObject(location.bucket, location.artifactKey, {
        ...artifact,
        latestSessionSummary: params.latestSessionSummary,
      } satisfies DiagramArtifact);
      return true;
    },
  });
}
