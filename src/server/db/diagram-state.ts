import { and, eq } from "drizzle-orm";

import type {
  DiagramGraph,
  GenerationSessionAudit,
} from "~/features/diagram/graph";
import { db } from "~/server/db";
import { diagramCache } from "~/server/db/schema";

export interface DiagramStateRecord {
  diagram: string | null;
  explanation: string | null;
  graph: DiagramGraph | null;
  latestSessionAudit: GenerationSessionAudit | null;
  lastSuccessfulAt: string | null;
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function getDiagramStateRecord(
  username: string,
  repo: string,
): Promise<DiagramStateRecord> {
  const result = await db
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

export async function upsertLatestSessionAudit(params: {
  username: string;
  repo: string;
  audit: GenerationSessionAudit;
}) {
  await db
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

export async function saveSuccessfulDiagramState(params: {
  username: string;
  repo: string;
  explanation: string;
  graph: DiagramGraph;
  diagram: string;
  audit: GenerationSessionAudit;
  usedOwnKey: boolean;
}) {
  const successfulAt = new Date();

  await db
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

export async function recordLatestSessionRenderError(params: {
  username: string;
  repo: string;
  renderError: string;
}) {
  const current = await getDiagramStateRecord(params.username, params.repo);
  const audit = current.latestSessionAudit;
  if (!audit) {
    return;
  }

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
    audit: nextAudit,
  });
}
