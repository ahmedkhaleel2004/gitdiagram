import { and, eq } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";

import type {
  DiagramGraph,
  GenerationSessionAudit,
} from "~/features/diagram/graph";
import { getDb, hasDb } from "~/server/db";
import { diagramCache } from "~/server/db/schema";
import {
  getStoredDiagramArtifact,
  getStoredDiagramState,
  toStoredSessionSummary,
  updateArtifactLatestSessionSummary,
  writeDiagramArtifact,
} from "~/server/storage/artifact-store";
import {
  getDiagramCacheBackend,
  hasPostgresConfig,
  isPostgresFallbackEnabled,
} from "~/server/storage/config";
import { clearFailureSummary, getStoredFailureState, writeFailureSummary } from "~/server/storage/status-store";
import type { ArtifactVisibility } from "~/server/storage/types";

export interface DiagramStateRecord {
  diagram: string | null;
  explanation: string | null;
  graph: DiagramGraph | null;
  latestSessionAudit: GenerationSessionAudit | null;
  lastSuccessfulAt: string | null;
}

function getDiagramStateTag(username: string, repo: string) {
  return `diagram-state:${username}:${repo}`;
}

function shouldUsePostgresForReads() {
  const backend = getDiagramCacheBackend();
  if (backend === "postgres") {
    return true;
  }
  return hasPostgresConfig() && isPostgresFallbackEnabled();
}

function shouldDualWriteToPostgres() {
  return getDiagramCacheBackend() === "dual" && hasPostgresConfig();
}

function shouldUseObjectStorage() {
  const backend = getDiagramCacheBackend();
  return backend === "dual" || backend === "object";
}

function inferVisibility(params: {
  visibility?: ArtifactVisibility;
  githubPat?: string;
}): ArtifactVisibility {
  return params.visibility ?? (params.githubPat?.trim() ? "private" : "public");
}

function revalidateDiagramState(params: {
  username: string;
  repo: string;
  visibility: ArtifactVisibility;
}) {
  if (params.visibility === "public") {
    revalidateTag(getDiagramStateTag(params.username, params.repo), "max");
  }
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

async function getDiagramStateRecordFromPostgres(
  username: string,
  repo: string,
): Promise<DiagramStateRecord> {
  if (!hasDb()) {
    return {
      diagram: null,
      explanation: null,
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: null,
    };
  }

  const result = await getDb()
    .select()
    .from(diagramCache)
    .where(and(eq(diagramCache.username, username), eq(diagramCache.repo, repo)))
    .limit(1);

  const row = result[0];
  return {
    diagram: row?.diagram || null,
    explanation: row?.explanation || null,
    graph: row?.graph ?? null,
    latestSessionAudit: row?.latestSessionAudit ?? null,
    lastSuccessfulAt: toIsoString(row?.lastSuccessfulAt),
  };
}

async function upsertLatestSessionAuditInPostgres(params: {
  username: string;
  repo: string;
  audit: GenerationSessionAudit;
}) {
  if (!hasDb()) {
    return;
  }

  await getDb()
    .insert(diagramCache)
    .values({
      username: params.username,
      repo: params.repo,
      latestSessionId: params.audit.sessionId,
      latestSessionStatus: params.audit.status,
      latestSessionStage: params.audit.stage,
      latestSessionProvider: params.audit.provider,
      latestSessionModel: params.audit.model,
      latestSessionAudit: params.audit,
    })
    .onConflictDoUpdate({
      target: [diagramCache.username, diagramCache.repo],
      set: {
        latestSessionId: params.audit.sessionId,
        latestSessionStatus: params.audit.status,
        latestSessionStage: params.audit.stage,
        latestSessionProvider: params.audit.provider,
        latestSessionModel: params.audit.model,
        latestSessionAudit: params.audit,
        updatedAt: new Date(),
      },
    });
}

async function saveSuccessfulDiagramStateInPostgres(params: {
  username: string;
  repo: string;
  explanation: string;
  graph: DiagramGraph;
  diagram: string;
  audit: GenerationSessionAudit;
  usedOwnKey: boolean;
}) {
  if (!hasDb()) {
    return;
  }

  const successfulAt = new Date();
  await getDb()
    .insert(diagramCache)
    .values({
      username: params.username,
      repo: params.repo,
      diagram: params.diagram,
      explanation: params.explanation,
      graph: params.graph,
      latestSessionId: params.audit.sessionId,
      latestSessionStatus: params.audit.status,
      latestSessionStage: params.audit.stage,
      latestSessionProvider: params.audit.provider,
      latestSessionModel: params.audit.model,
      latestSessionAudit: params.audit,
      lastSuccessfulAt: successfulAt,
      usedOwnKey: params.usedOwnKey,
    })
    .onConflictDoUpdate({
      target: [diagramCache.username, diagramCache.repo],
      set: {
        diagram: params.diagram,
        explanation: params.explanation,
        graph: params.graph,
        latestSessionId: params.audit.sessionId,
        latestSessionStatus: params.audit.status,
        latestSessionStage: params.audit.stage,
        latestSessionProvider: params.audit.provider,
        latestSessionModel: params.audit.model,
        latestSessionAudit: params.audit,
        lastSuccessfulAt: successfulAt,
        usedOwnKey: params.usedOwnKey,
        updatedAt: successfulAt,
      },
    });
}

export async function getDiagramStateRecord(
  username: string,
  repo: string,
  githubPat?: string,
): Promise<DiagramStateRecord> {
  if (shouldUseObjectStorage()) {
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
  }

  if (shouldUsePostgresForReads()) {
    return getDiagramStateRecordFromPostgres(username, repo);
  }

  return {
    diagram: null,
    explanation: null,
    graph: null,
    latestSessionAudit: null,
    lastSuccessfulAt: null,
  };
}

export async function getCachedDiagramStateRecord(
  username: string,
  repo: string,
  githubPat?: string,
): Promise<DiagramStateRecord> {
  if (githubPat?.trim()) {
    return getDiagramStateRecord(username, repo, githubPat);
  }

  return unstable_cache(
    async () => getDiagramStateRecord(username, repo),
    ["diagram-state", username, repo],
    {
      tags: [getDiagramStateTag(username, repo)],
      revalidate: 60 * 60,
    },
  )();
}

export async function upsertLatestSessionAudit(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility?: ArtifactVisibility;
  audit: GenerationSessionAudit;
}) {
  const visibility = inferVisibility(params);

  if (getDiagramCacheBackend() === "postgres") {
    await upsertLatestSessionAuditInPostgres(params);
    revalidateDiagramState({ username: params.username, repo: params.repo, visibility });
    return;
  }

  const slimAudit = toStoredSessionSummary(params.audit);

  if (params.audit.status === "failed") {
    const artifactUpdated = await updateArtifactLatestSessionSummary({
      username: params.username,
      repo: params.repo,
      githubPat: params.githubPat,
      visibility,
      latestSessionSummary: slimAudit,
    });

    if (!artifactUpdated) {
      await writeFailureSummary({
        username: params.username,
        repo: params.repo,
        githubPat: params.githubPat,
        visibility,
        latestSessionSummary: slimAudit,
      });
    } else {
      await clearFailureSummary({
        username: params.username,
        repo: params.repo,
        githubPat: params.githubPat,
        visibility,
      });
    }
  }

  if (shouldDualWriteToPostgres() && params.audit.status !== "running") {
    await upsertLatestSessionAuditInPostgres(params);
  }

  if (params.audit.status === "failed") {
    revalidateDiagramState({ username: params.username, repo: params.repo, visibility });
  }
}

export async function saveSuccessfulDiagramState(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  explanation: string;
  graph: DiagramGraph;
  diagram: string;
  audit: GenerationSessionAudit;
  usedOwnKey: boolean;
}) {
  const successfulAt = params.audit.updatedAt || new Date().toISOString();

  if (shouldUseObjectStorage()) {
    await writeDiagramArtifact({
      username: params.username,
      repo: params.repo,
      githubPat: params.githubPat,
      visibility: params.visibility,
      diagram: params.diagram,
      explanation: params.explanation,
      graph: params.graph,
      generatedAt: successfulAt,
      usedOwnKey: params.usedOwnKey,
      latestSessionSummary: toStoredSessionSummary(params.audit),
      lastSuccessfulAt: successfulAt,
    });
    await clearFailureSummary({
      username: params.username,
      repo: params.repo,
      githubPat: params.githubPat,
      visibility: params.visibility,
    });
  }

  if (getDiagramCacheBackend() === "postgres" || shouldDualWriteToPostgres()) {
    await saveSuccessfulDiagramStateInPostgres(params);
  }

  revalidateDiagramState({
    username: params.username,
    repo: params.repo,
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

  const nextAudit: GenerationSessionAudit = {
    ...audit,
    status: "failed",
    stage: "error",
    failureStage: "browser_render",
    renderError: params.renderError,
    updatedAt: new Date().toISOString(),
    timeline: [
      ...audit.timeline,
      {
        stage: "browser_render",
        message: params.renderError,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  await upsertLatestSessionAudit({
    username: params.username,
    repo: params.repo,
    githubPat: params.githubPat,
    visibility,
    audit: nextAudit,
  });
}
