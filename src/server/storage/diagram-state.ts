import type {
  DiagramGraph,
  GenerationSessionAudit,
} from "~/features/diagram/graph";
import {
  getStoredDiagramState,
  toStoredSessionSummary,
  updateArtifactLatestSessionSummary,
  writeDiagramArtifact,
} from "~/server/storage/artifact-store";
import {
  clearFailureSummary,
  getStoredFailureState,
  writeFailureSummary,
} from "~/server/storage/status-store";
import { upsertBrowseIndexEntry } from "~/server/storage/browse-diagrams";
import type { ArtifactVisibility } from "~/server/storage/types";

export interface DiagramStateRecord {
  diagram: string | null;
  explanation: string | null;
  graph: DiagramGraph | null;
  latestSessionAudit: GenerationSessionAudit | null;
  lastSuccessfulAt: string | null;
  /** Full SHA of the commit the state is for; absent for the default branch. */
  commit?: string;
}

function inferVisibility(params: {
  visibility?: ArtifactVisibility;
  githubPat?: string;
}): ArtifactVisibility {
  return params.visibility ?? (params.githubPat?.trim() ? "private" : "public");
}

/**
 * What is stored for a repository, or for one commit of it when `commit` (the
 * full SHA) is given. The two never mix: a commit reads only its own keys, and
 * the default-branch state is never shown for a commit.
 */
export async function getDiagramStateRecord(
  username: string,
  repo: string,
  githubPat?: string,
  commit?: string,
): Promise<DiagramStateRecord> {
  const storedArtifactState = await getStoredDiagramState({
    username,
    repo,
    githubPat,
    commit,
  });
  if (storedArtifactState) {
    return commit ? { ...storedArtifactState, commit } : storedArtifactState;
  }

  const storedFailureState = await getStoredFailureState({
    username,
    repo,
    githubPat,
    commit,
  });
  if (storedFailureState) {
    return commit ? { ...storedFailureState, commit } : storedFailureState;
  }

  return {
    diagram: null,
    explanation: null,
    graph: null,
    latestSessionAudit: null,
    lastSuccessfulAt: null,
    ...(commit ? { commit } : {}),
  };
}

export async function persistTerminalSessionAudit(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility?: ArtifactVisibility;
  /** Full SHA of the commit a diagram is for; absent for the default branch. */
  commit?: string;
  audit: GenerationSessionAudit;
}) {
  if (params.audit.status !== "failed" && params.audit.status !== "succeeded") {
    return;
  }

  const visibility = inferVisibility(params);
  const slimAudit = toStoredSessionSummary(params.audit);
  const artifactUpdated = await updateArtifactLatestSessionSummary({
    username: params.username,
    repo: params.repo,
    commit: params.commit,
    githubPat: params.githubPat,
    visibility,
    latestSessionSummary: slimAudit,
  });

  if (!artifactUpdated && params.audit.status === "failed") {
    await writeFailureSummary({
      username: params.username,
      repo: params.repo,
      commit: params.commit,
      githubPat: params.githubPat,
      visibility,
      latestSessionSummary: slimAudit,
    });
    return;
  }

  if (artifactUpdated || params.audit.status === "succeeded") {
    await clearFailureSummary({
      username: params.username,
      repo: params.repo,
      commit: params.commit,
      githubPat: params.githubPat,
      visibility,
    });
  }
}

export async function saveSuccessfulDiagramState(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  /** Full SHA of the commit a diagram is for; absent for the default branch. */
  commit?: string;
  stargazerCount: number | null;
  explanation: string;
  graph: DiagramGraph;
  diagram: string;
  audit: GenerationSessionAudit;
  usedOwnKey: boolean;
}) {
  const successfulAt = params.audit.updatedAt || new Date().toISOString();

  const artifactWritten = await writeDiagramArtifact({
    username: params.username,
    repo: params.repo,
    commit: params.commit,
    githubPat: params.githubPat,
    visibility: params.visibility,
    stargazerCount: params.stargazerCount,
    diagram: params.diagram,
    explanation: params.explanation,
    graph: params.graph,
    generatedAt: successfulAt,
    usedOwnKey: params.usedOwnKey,
    latestSessionSummary: toStoredSessionSummary(params.audit),
    lastSuccessfulAt: successfulAt,
  });

  if (!artifactWritten) {
    return false;
  }

  return true;
}

export async function clearSuccessfulDiagramFailureSummary(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  /** Full SHA of the commit a diagram is for; absent for the default branch. */
  commit?: string;
}): Promise<void> {
  await clearFailureSummary(params);
}

export async function updatePublicBrowseIndexForSuccessfulDiagram(params: {
  username: string;
  repo: string;
  lastSuccessfulAt: string;
  stargazerCount: number | null;
}) {
  await upsertBrowseIndexEntry({
    username: params.username,
    repo: params.repo,
    lastSuccessfulAt: params.lastSuccessfulAt,
    stargazerCount: params.stargazerCount,
  });
}
