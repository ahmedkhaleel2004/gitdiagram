import type { GenerationSessionAudit } from "~/features/diagram/graph";
import {
  finalizeComplimentaryQuota,
  type ComplimentaryQuotaReservation,
} from "~/server/generate/complimentary-gate";
import type { GenerationUsageAccounting } from "~/server/generate/graph-planner";
import type { GraphValidationCategory } from "~/server/generate/graph";
import { sumGenerationUsage } from "~/server/generate/pricing";
import { refundGenerationRateLimit } from "~/server/generate/rate-limit";
import type { GenerationStreamState } from "~/server/generate/sse-writer";
import {
  persistGenerationResult,
  type SuccessfulDiagramState,
} from "~/server/storage/generation-persistence";
import type { ArtifactVisibility } from "~/server/storage/types";

type PostResponseTask = () => Promise<void>;

export interface FinalizeGenerationStreamParams {
  abortCause: "client" | "deadline" | null;
  accounting: GenerationUsageAccounting;
  apiKey?: string;
  audit: GenerationSessionAudit;
  githubPat?: string;
  postResponseTasks: PostResponseTask[];
  quotaReservation: ComplimentaryQuotaReservation | null;
  rateLimitedClientIp: string | null;
  recordTiming: (stage: string, startedAt: number) => void;
  repo: string;
  repositoryVerified: boolean;
  sendTerminal: (
    audit: GenerationSessionAudit,
    persistenceWarning?: string,
  ) => Promise<boolean>;
  storageVisibility: ArtifactVisibility;
  streamState: GenerationStreamState;
  successfulDiagramState: SuccessfulDiagramState | null;
  username: string;
}

export async function finalizeGenerationStream(
  params: FinalizeGenerationStreamParams,
): Promise<GenerationSessionAudit> {
  let audit = params.audit;
  let terminalSent = false;
  let persistenceWarning: string | undefined;

  if (params.abortCause === "deadline") {
    terminalSent = await params.sendTerminal(audit);
  }

  if (params.quotaReservation) {
    const quotaFinalizationStartedAt = performance.now();
    const measuredCommittedTokens = sumGenerationUsage(
      ...params.accounting.actualUsages,
    ).totalTokens;
    const actualCommittedTokens =
      params.accounting.hasCompleteMeasuredUsage &&
      !params.streamState.wasCancelled
        ? measuredCommittedTokens
        : Math.min(
            params.quotaReservation.reservedTokens,
            measuredCommittedTokens +
              params.accounting.completedUnmeasuredTokenBound +
              params.accounting.pendingModelRequestTokenBound,
          );

    try {
      await finalizeComplimentaryQuota({
        reservation: params.quotaReservation,
        committedTokens: actualCommittedTokens,
      });
      audit = {
        ...audit,
        quotaStatus: "finalized",
        quotaBucket: params.quotaReservation.quotaBucket,
        quotaDateUtc: params.quotaReservation.quotaDateUtc,
        actualCommittedTokens,
        quotaResetAt: params.quotaReservation.quotaResetAt,
      };
    } catch (quotaError) {
      console.error(
        JSON.stringify({
          event: "generate.quota.finalization_failed",
          session_id: audit.sessionId,
          error:
            quotaError instanceof Error ? quotaError.message : "Unknown error",
        }),
      );
    } finally {
      params.recordTiming("quota_finalization", quotaFinalizationStartedAt);
    }
  }

  if (params.repositoryVerified) {
    persistenceWarning = await persistGenerationResult({
      username: params.username,
      repo: params.repo,
      githubPat: params.githubPat,
      visibility: params.storageVisibility,
      audit,
      successfulDiagramState: params.successfulDiagramState,
      usedOwnKey: Boolean(params.apiKey),
      postResponseTasks: params.postResponseTasks,
      recordTiming: params.recordTiming,
    });
  } else if (params.rateLimitedClientIp) {
    params.postResponseTasks.push(() =>
      refundGenerationRateLimit({
        clientIp: params.rateLimitedClientIp,
      }),
    );
  }

  if (!terminalSent) {
    await params.sendTerminal(audit, persistenceWarning);
  }

  return audit;
}

export function logGenerationFinished(params: {
  accounting: GenerationUsageAccounting;
  audit: GenerationSessionAudit;
  graphValidationCategoryCounts: Partial<
    Record<GraphValidationCategory, number>
  >;
  invocationStartedAt: number;
  stageTimingsMs: Record<string, number>;
  storageVisibility: ArtifactVisibility;
  streamState: GenerationStreamState;
  terminalErrorCode: string | null;
}) {
  const totalUsage = sumGenerationUsage(...params.accounting.actualUsages);
  console.info(
    JSON.stringify({
      event: "generate.stream.finished",
      session_id: params.audit.sessionId,
      outcome: params.streamState.wasCancelled
        ? "cancelled"
        : params.audit.status === "succeeded"
          ? "succeeded"
          : "failed",
      error_code: params.terminalErrorCode,
      stage: params.audit.failureStage ?? params.audit.stage,
      elapsed_ms: Math.round(performance.now() - params.invocationStartedAt),
      stage_timings_ms: params.stageTimingsMs,
      provider: params.audit.provider,
      model: params.audit.model,
      visibility: params.storageVisibility,
      input_tokens: totalUsage.inputTokens,
      output_tokens: totalUsage.outputTokens,
      total_tokens: totalUsage.totalTokens,
      cached_input_tokens: totalUsage.cachedInputTokens ?? 0,
      reasoning_tokens: totalUsage.reasoningTokens ?? 0,
      graph_validation_categories: params.graphValidationCategoryCounts,
      quota_committed_tokens: params.audit.actualCommittedTokens ?? null,
    }),
  );
}
