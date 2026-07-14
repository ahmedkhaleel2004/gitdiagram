import type {
  GenerationCostSummary,
  GenerationStageUsage,
} from "~/features/diagram/cost";
import type {
  DiagramGraph,
  GenerationSessionAudit,
  GraphAttemptAudit,
} from "~/features/diagram/graph";

function nowIso(): string {
  return new Date().toISOString();
}

export function createGenerationSessionAudit(params: {
  sessionId: string;
  provider: string;
  model: string;
}): GenerationSessionAudit {
  const createdAt = nowIso();
  return {
    sessionId: params.sessionId,
    status: "running",
    stage: "started",
    provider: params.provider,
    model: params.model,
    graph: null,
    graphAttempts: [],
    stageUsages: [],
    timeline: [{ stage: "started", createdAt }],
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Projects the internal audit onto the small, diagnostic summary that is safe
 * to repeat in a terminal SSE event. The terminal event already carries the
 * successful explanation, graph, and Mermaid source at the top level, so
 * embedding them (and the successful graph attempt) in the audit multiplies
 * the response size without giving the client any new information.
 *
 * Failed graph attempts remain useful when generation does not complete. Keep
 * their raw model output and validation feedback, but drop the parsed graph
 * because it is a second representation of the same output.
 */
export function toTerminalSessionAudit(
  audit: GenerationSessionAudit,
): GenerationSessionAudit {
  const failedGraphAttempts: GenerationSessionAudit["graphAttempts"] = [];
  if (audit.status === "failed") {
    for (const attempt of audit.graphAttempts) {
      if (attempt.status === "failed") {
        failedGraphAttempts.push({ ...attempt, graph: null });
      }
    }
  }

  return {
    sessionId: audit.sessionId,
    status: audit.status,
    stage: audit.stage,
    provider: audit.provider,
    model: audit.model,
    quotaStatus: audit.quotaStatus,
    quotaBucket: audit.quotaBucket,
    quotaDateUtc: audit.quotaDateUtc,
    actualCommittedTokens: audit.actualCommittedTokens,
    quotaResetAt: audit.quotaResetAt,
    estimatedCost: audit.estimatedCost,
    finalCost: audit.finalCost,
    // Successful terminals already carry the graph at the top level. Keep it
    // for failures where compiler diagnostics otherwise lose their context.
    graph: audit.status === "failed" ? audit.graph : null,
    graphAttempts: failedGraphAttempts,
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

export function withTimelineEvent(
  audit: GenerationSessionAudit,
  stage: string,
  message?: string,
): GenerationSessionAudit {
  const createdAt = nowIso();
  return {
    ...audit,
    stage,
    updatedAt: createdAt,
    timeline: [...audit.timeline, { stage, message, createdAt }],
  };
}

export function withExplanation(
  audit: GenerationSessionAudit,
  explanation: string,
): GenerationSessionAudit {
  return {
    ...audit,
    explanation,
    updatedAt: nowIso(),
  };
}

export function withEstimatedCost(
  audit: GenerationSessionAudit,
  estimatedCost: GenerationCostSummary,
): GenerationSessionAudit {
  return {
    ...audit,
    estimatedCost,
    updatedAt: nowIso(),
  };
}

export function withFinalCost(
  audit: GenerationSessionAudit,
  finalCost: GenerationCostSummary,
): GenerationSessionAudit {
  return {
    ...audit,
    finalCost,
    updatedAt: nowIso(),
  };
}

export function withStageUsage(
  audit: GenerationSessionAudit,
  stageUsage: GenerationStageUsage,
): GenerationSessionAudit {
  return {
    ...audit,
    stageUsages: [...audit.stageUsages, stageUsage],
    updatedAt: nowIso(),
  };
}

export function withGraphAttempt(
  audit: GenerationSessionAudit,
  attempt: GraphAttemptAudit,
): GenerationSessionAudit {
  return {
    ...audit,
    graphAttempts: [...audit.graphAttempts, attempt],
    updatedAt: nowIso(),
  };
}

export function withGraph(
  audit: GenerationSessionAudit,
  graph: DiagramGraph,
): GenerationSessionAudit {
  return {
    ...audit,
    graph,
    updatedAt: nowIso(),
  };
}

export function withCompiledDiagram(
  audit: GenerationSessionAudit,
  diagram: string,
): GenerationSessionAudit {
  return {
    ...audit,
    compiledDiagram: diagram,
    updatedAt: nowIso(),
  };
}

export function withFailure(
  audit: GenerationSessionAudit,
  params: {
    failureStage: string;
    validationError?: string;
    compilerError?: string;
    renderError?: string;
  },
): GenerationSessionAudit {
  return {
    ...audit,
    status: "failed",
    failureStage: params.failureStage,
    validationError: params.validationError,
    compilerError: params.compilerError,
    renderError: params.renderError,
    updatedAt: nowIso(),
  };
}

export function withSuccess(
  audit: GenerationSessionAudit,
): GenerationSessionAudit {
  return {
    ...audit,
    status: "succeeded",
    updatedAt: nowIso(),
  };
}
