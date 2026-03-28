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
    timeline: [{ stage: "started", createdAt }],
    createdAt,
    updatedAt: createdAt,
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

export function withSuccess(audit: GenerationSessionAudit): GenerationSessionAudit {
  return {
    ...audit,
    status: "succeeded",
    updatedAt: nowIso(),
  };
}
