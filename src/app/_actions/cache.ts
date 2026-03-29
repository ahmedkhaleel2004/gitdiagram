"use server";

import type { DiagramStateResponse } from "~/features/diagram/types";
import {
  getDiagramStateRecord,
  recordLatestSessionRenderError,
} from "~/server/storage/diagram-state";

export async function getDiagramState(
  username: string,
  repo: string,
  githubPat?: string,
): Promise<DiagramStateResponse> {
  try {
    return await getDiagramStateRecord(username, repo, githubPat);
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
