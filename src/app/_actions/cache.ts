"use server";

import { sql } from "drizzle-orm";

import type { DiagramStateResponse } from "~/features/diagram/types";
import { db } from "~/server/db";
import {
  getDiagramStateRecord,
  recordLatestSessionRenderError,
} from "~/server/db/diagram-state";
import { diagramCache } from "~/server/db/schema";

export async function getDiagramState(
  username: string,
  repo: string,
): Promise<DiagramStateResponse> {
  try {
    return await getDiagramStateRecord(username, repo);
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
    const stats = await db
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
) {
  try {
    await recordLatestSessionRenderError({ username, repo, renderError });
  } catch (error) {
    console.error("Error recording diagram render error:", error);
  }
}
