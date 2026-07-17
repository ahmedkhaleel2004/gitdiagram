import { revalidatePath, revalidateTag } from "next/cache";

import { revalidateBrowseIndexCache } from "~/server/browse-index-cache";
import type {
  DiagramGraph,
  GenerationSessionAudit,
} from "~/features/diagram/graph";
import {
  clearSuccessfulDiagramFailureSummary,
  persistTerminalSessionAudit,
  saveSuccessfulDiagramState,
  updatePublicBrowseIndexForSuccessfulDiagram,
} from "./diagram-state";
import { writePublicDiagramPreview } from "./artifact-store";
import {
  getPublicDiagramStateCacheTag,
  getRepoPagePath,
} from "./repo-page-cache";
import type { ArtifactVisibility } from "./types";

export interface SuccessfulDiagramState {
  stargazerCount: number | null;
  explanation: string;
  graph: DiagramGraph;
  diagram: string;
}

export async function persistGenerationResult(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  audit: GenerationSessionAudit;
  successfulDiagramState: SuccessfulDiagramState | null;
  usedOwnKey: boolean;
  postResponseTasks: Array<() => Promise<void>>;
  recordTiming: (stage: string, startedAt: number) => void;
}): Promise<string | undefined> {
  const persistenceStartedAt = performance.now();

  try {
    if (params.successfulDiagramState && params.audit.status === "succeeded") {
      const successfulDiagramState = params.successfulDiagramState;
      const artifactPersistenceStartedAt = performance.now();
      const artifactWritten = await saveSuccessfulDiagramState({
        username: params.username,
        repo: params.repo,
        githubPat: params.githubPat,
        visibility: params.visibility,
        stargazerCount: successfulDiagramState.stargazerCount,
        explanation: successfulDiagramState.explanation,
        graph: successfulDiagramState.graph,
        diagram: successfulDiagramState.diagram,
        audit: params.audit,
        usedOwnKey: params.usedOwnKey,
      });
      params.recordTiming("artifact_persistence", artifactPersistenceStartedAt);

      if (artifactWritten) {
        params.postResponseTasks.push(async () => {
          try {
            await clearSuccessfulDiagramFailureSummary({
              username: params.username,
              repo: params.repo,
              githubPat: params.githubPat,
              visibility: params.visibility,
            });
          } catch (error) {
            console.error(
              JSON.stringify({
                event: "generate.persistence.failure_summary_cleanup_failed",
                session_id: params.audit.sessionId,
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            );
          }
        });
      }

      if (params.visibility === "public" && artifactWritten) {
        const lastSuccessfulAt =
          params.audit.updatedAt ?? new Date().toISOString();
        params.postResponseTasks.push(async () => {
          try {
            await writePublicDiagramPreview({
              username: params.username,
              repo: params.repo,
              diagram: successfulDiagramState.diagram,
              lastSuccessfulAt,
            });
          } catch (error) {
            console.warn(
              JSON.stringify({
                event: "generate.persistence.preview_write_failed",
                session_id: params.audit.sessionId,
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            );
          }
        });
        params.postResponseTasks.push(async () => {
          try {
            revalidatePath(getRepoPagePath(params.username, params.repo));
            revalidateTag(
              getPublicDiagramStateCacheTag(params.username, params.repo),
              "max",
            );
            await updatePublicBrowseIndexForSuccessfulDiagram({
              username: params.username,
              repo: params.repo,
              lastSuccessfulAt,
              stargazerCount: successfulDiagramState.stargazerCount,
            });
            revalidateBrowseIndexCache();
          } catch (error) {
            console.error(
              "Failed to update browse index after completion:",
              error,
            );
          }
        });
      }
    } else {
      const auditPersistenceStartedAt = performance.now();
      await persistTerminalSessionAudit({
        username: params.username,
        repo: params.repo,
        githubPat: params.githubPat,
        visibility: params.visibility,
        audit: params.audit,
      });
      params.recordTiming("audit_persistence", auditPersistenceStartedAt);
    }
  } catch (persistenceError) {
    console.error(
      JSON.stringify({
        event:
          params.successfulDiagramState && params.audit.status === "succeeded"
            ? "generate.persistence.diagram_failed"
            : "generate.persistence.audit_failed",
        session_id: params.audit.sessionId,
        error:
          persistenceError instanceof Error
            ? persistenceError.message
            : "Unknown error",
      }),
    );
    if (params.successfulDiagramState && params.audit.status === "succeeded") {
      return "The diagram was generated, but could not be cached. It may need to be regenerated after a refresh.";
    }
  } finally {
    params.recordTiming("persistence", persistenceStartedAt);
  }

  return undefined;
}
