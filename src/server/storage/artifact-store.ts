import type { DiagramStateResponse } from "~/features/diagram/types";
import type { GenerationSessionAudit } from "~/features/diagram/graph";
import {
  getPrivateLocation,
  getReadLocations,
  getPublicLocation,
  type StorageLocation,
} from "~/server/storage/cache-key";
import { getJsonObject, putJsonObject } from "~/server/storage/r2";
import type {
  ArtifactVisibility,
  DiagramArtifact,
} from "~/server/storage/types";

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
    reservedTokens: audit.reservedTokens,
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

export async function writeDiagramArtifact(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  diagram: string;
  explanation: string;
  graph: GenerationSessionAudit["graph"];
  generatedAt: string;
  usedOwnKey: boolean;
  latestSessionSummary: GenerationSessionAudit;
  lastSuccessfulAt: string;
}): Promise<void> {
  const location =
    params.visibility === "private"
      ? getPrivateLocation(params.username, params.repo, params.githubPat ?? "")
      : getPublicLocation(params.username, params.repo);

  const artifact: DiagramArtifact = {
    version: 1,
    visibility: params.visibility,
    username: params.username,
    repo: params.repo,
    diagram: params.diagram,
    explanation: params.explanation,
    graph: params.graph,
    generatedAt: params.generatedAt,
    usedOwnKey: params.usedOwnKey,
    latestSessionSummary: params.latestSessionSummary,
    lastSuccessfulAt: params.lastSuccessfulAt,
  };

  await putJsonObject(location.bucket, location.artifactKey, artifact);
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

  const artifact = await getArtifactForLocation(location);
  if (!artifact) {
    return false;
  }

  await putJsonObject(location.bucket, location.artifactKey, {
    ...artifact,
    latestSessionSummary: params.latestSessionSummary,
  } satisfies DiagramArtifact);
  return true;
}
