"use server";

import { sql } from "drizzle-orm";

import type { DiagramStateResponse } from "~/features/diagram/types";
import { getDb, hasDb } from "~/server/db";
import {
  getCachedDiagramStateRecord,
  recordLatestSessionRenderError,
} from "~/server/db/diagram-state";
import { diagramCache } from "~/server/db/schema";

export async function getDiagramState(
  username: string,
  repo: string,
  githubPat?: string,
): Promise<DiagramStateResponse> {
  try {
    return await getCachedDiagramStateRecord(username, repo, githubPat);
  } catch (error) {
    console.error("Error fetching diagram state:", error);
    return {
      diagram: null,
      explanation: null,
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: null,
    };
  }
}

export async function getDiagramStats() {
  try {
    if (!hasDb()) {
      return null;
    }

    const stats = await getDb()
      .select({
        totalDiagrams: sql`COUNT(*)`,
        ownKeyUsers: sql`COUNT(CASE WHEN ${diagramCache.usedOwnKey} = true THEN 1 END)`,
        freeUsers: sql`COUNT(CASE WHEN ${diagramCache.usedOwnKey} = false THEN 1 END)`,
      })
      .from(diagramCache);

    return stats[0];
  } catch (error) {
    console.error("Error getting diagram stats:", error);
    return null;
  }
}

export async function persistDiagramRenderError(
  username: string,
  repo: string,
  renderError: string,
  githubPat?: string,
) {
  try {
    await recordLatestSessionRenderError({
      username,
      repo,
      githubPat,
      renderError,
    });
  } catch (error) {
    console.error("Error recording diagram render error:", error);
  }
}
