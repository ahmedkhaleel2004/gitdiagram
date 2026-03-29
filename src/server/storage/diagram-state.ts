import type {
  DiagramGraph,
  GenerationSessionAudit,
} from "~/features/diagram/graph";
import {
  getStoredDiagramArtifact,
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
}

function inferVisibility(params: {
  visibility?: ArtifactVisibility;
  githubPat?: string;
}): ArtifactVisibility {
  return params.visibility ?? (params.githubPat?.trim() ? "private" : "public");
}

export async function getDiagramStateRecord(
  username: string,
  repo: string,
  githubPat?: string,
): Promise<DiagramStateRecord> {
  const storedArtifactState = await getStoredDiagramState({
    username,
    repo,
    githubPat,
  });
  if (storedArtifactState) {
    return storedArtifactState;
  }

  const storedFailureState = await getStoredFailureState({
    username,
    repo,
    githubPat,
  });
  if (storedFailureState) {
    return storedFailureState;
  }

  return {
    diagram: null,
    explanation: null,
    graph: null,
    latestSessionAudit: null,
    lastSuccessfulAt: null,
  };
}

export async function persistTerminalSessionAudit(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility?: ArtifactVisibility;
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
    githubPat: params.githubPat,
    visibility,
    latestSessionSummary: slimAudit,
  });

  if (!artifactUpdated && params.audit.status === "failed") {
    await writeFailureSummary({
      username: params.username,
      repo: params.repo,
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
  stargazerCount: number | null;
  explanation: string;
  graph: DiagramGraph;
  diagram: string;
  audit: GenerationSessionAudit;
  usedOwnKey: boolean;
}) {
  const successfulAt = params.audit.updatedAt || new Date().toISOString();

  await writeDiagramArtifact({
    username: params.username,
    repo: params.repo,
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

  if (params.visibility === "public") {
    await upsertBrowseIndexEntry({
      username: params.username,
      repo: params.repo,
      lastSuccessfulAt: successfulAt,
      stargazerCount: params.stargazerCount,
    });
  }

  await clearFailureSummary({
    username: params.username,
    repo: params.repo,
    githubPat: params.githubPat,
    visibility: params.visibility,
  });
}

export async function recordLatestSessionRenderError(params: {
  username: string;
  repo: string;
  githubPat?: string;
  renderError: string;
}) {
  const current = await getDiagramStateRecord(
    params.username,
    params.repo,
    params.githubPat,
  );
  const audit = current.latestSessionAudit;
  if (!audit) {
    return;
  }

  const visibility =
    (
      await getStoredDiagramArtifact({
        username: params.username,
        repo: params.repo,
        githubPat: params.githubPat,
      })
    )?.location.visibility ?? inferVisibility(params);

  const timestamp = new Date().toISOString();
  const nextAudit: GenerationSessionAudit = {
    ...audit,
    status: "failed",
    stage: "error",
    failureStage: "browser_render",
    renderError: params.renderError,
    updatedAt: timestamp,
    timeline: [
      ...audit.timeline,
      {
        stage: "browser_render",
        message: params.renderError,
        createdAt: timestamp,
      },
    ],
  };

  await persistTerminalSessionAudit({
    username: params.username,
    repo: params.repo,
    githubPat: params.githubPat,
    visibility,
    audit: nextAudit,
  });
}
