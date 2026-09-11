import type { GenerationTokenUsage } from "~/features/diagram/cost";
import {
  diagramGraphSchema,
  MAX_GRAPH_ATTEMPTS,
  type DiagramGraph,
  type GenerationSessionAudit,
  type GraphAttemptAudit,
} from "~/features/diagram/graph";
import type { DiagramStreamMessage } from "~/features/diagram/types";
import type { ComplimentaryAdmissionEstimate } from "./complimentary-gate";
import { buildComplimentaryStageTokenBound } from "./complimentary-gate";
import {
  GRAPH_MAX_OUTPUT_TOKENS,
  GRAPH_REASONING_EFFORT,
  GRAPH_TEXT_VERBOSITY,
} from "./generation-policy";
import { toTaggedMessage } from "./format";
import {
  formatGraphValidationFeedback,
  isRepairableWithoutRetry,
  stripUnknownNodePaths,
  type GraphValidationCategory,
  validateDiagramGraph,
} from "./graph";
import type { AIProvider } from "./model-config";
import { generateStructuredOutput } from "./openai";
import { createCostSummary } from "./pricing";
import { SYSTEM_GRAPH_PROMPT } from "./prompts";
import {
  withGraph,
  withGraphAttempt,
  withStageUsage,
  withTimelineEvent,
} from "./session-audit";

export interface GenerationUsageAccounting {
  actualUsages: GenerationTokenUsage[];
  hasCompleteMeasuredUsage: boolean;
  completedUnmeasuredTokenBound: number;
  pendingModelRequestTokenBound: number;
}

type StreamSend = (payload: DiagramStreamMessage) => Promise<boolean>;

interface GenerateValidatedGraphParams {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  sessionId: string;
  explanation: string;
  fileTree: string;
  fileTreeLookup: Set<string>;
  signal: AbortSignal;
  audit: GenerationSessionAudit;
  complimentaryEstimate: ComplimentaryAdmissionEstimate | null;
  accounting: GenerationUsageAccounting;
  validationCategoryCounts: Partial<Record<GraphValidationCategory, number>>;
  recordTiming: (stage: string, startedAt: number) => void;
  send: StreamSend;
}

export type ValidatedGraphResult =
  | {
      ok: true;
      audit: GenerationSessionAudit;
      graph: DiagramGraph;
    }
  | {
      ok: false;
      audit: GenerationSessionAudit;
      validationError: string;
    };

export async function generateValidatedGraph(
  params: GenerateValidatedGraphParams,
): Promise<ValidatedGraphResult> {
  let audit = params.audit;
  let validationFeedback: string | undefined;
  let previousGraphRaw: string | undefined;

  void params.send({
    status: "graph_sent",
    session_id: params.sessionId,
    message: `Sending graph planning request to ${params.model}...`,
  });

  for (let attempt = 1; attempt <= MAX_GRAPH_ATTEMPTS; attempt++) {
    params.signal.throwIfAborted();
    const status = attempt === 1 ? "graph" : "graph_retry";
    const message =
      attempt === 1
        ? "Planning repository graph..."
        : `Retrying graph planning (${attempt}/${MAX_GRAPH_ATTEMPTS})...`;

    audit = withTimelineEvent(audit, status, message);
    void params.send({
      status,
      session_id: params.sessionId,
      message,
      graph_attempts: audit.graphAttempts,
    });

    params.accounting.pendingModelRequestTokenBound =
      params.complimentaryEstimate
        ? buildComplimentaryStageTokenBound(params.complimentaryEstimate, {
            stage: "graph",
            attempt,
          })
        : 0;
    const graphStartedAt = performance.now();
    const {
      output: graph,
      rawText,
      usage,
    } = await generateStructuredOutput({
      provider: params.provider,
      model: params.model,
      systemPrompt: SYSTEM_GRAPH_PROMPT,
      userPrompt: toTaggedMessage(
        attempt === 1
          ? { explanation: params.explanation }
          : {
              explanation: params.explanation,
              file_tree: params.fileTree,
              previous_graph: previousGraphRaw,
              validation_feedback: validationFeedback,
            },
      ),
      schema: diagramGraphSchema,
      schemaName: "diagram_graph",
      apiKey: params.apiKey,
      reasoningEffort: GRAPH_REASONING_EFFORT,
      textVerbosity: GRAPH_TEXT_VERBOSITY,
      maxOutputTokens: GRAPH_MAX_OUTPUT_TOKENS,
      signal: params.signal,
      clientRequestId: `${params.sessionId}:graph:${attempt}`,
    });
    params.recordTiming(`graph_attempt_${attempt}`, graphStartedAt);

    if (usage) {
      params.accounting.actualUsages.push(usage);
      params.accounting.pendingModelRequestTokenBound = 0;
      audit = withStageUsage(audit, {
        stage: "graph_attempt",
        attempt,
        model: params.model,
        costSummary: createCostSummary({
          kind: "actual",
          model: params.model,
          usage,
          approximate: false,
        }),
        createdAt: new Date().toISOString(),
      });
    } else {
      params.accounting.hasCompleteMeasuredUsage = false;
      params.accounting.completedUnmeasuredTokenBound +=
        params.accounting.pendingModelRequestTokenBound;
      params.accounting.pendingModelRequestTokenBound = 0;
    }

    void params.send({
      status,
      session_id: params.sessionId,
      graph,
    });

    const graphValidationStartedAt = performance.now();
    const graphValidation = validateDiagramGraph(graph, params.fileTreeLookup);
    params.recordTiming(
      `graph_validation_${attempt}`,
      graphValidationStartedAt,
    );
    const validationCategories = [
      ...new Set(graphValidation.issues.map((issue) => issue.category)),
    ];
    for (const category of validationCategories) {
      params.validationCategoryCounts[category] =
        (params.validationCategoryCounts[category] ?? 0) + 1;
    }
    // Unresolvable paths only cost a node its GitHub link, so repair them in
    // place. Only structural problems are worth another model call.
    const repairableWithoutRetry = isRepairableWithoutRetry(
      graphValidation.issues,
    );
    const { graph: acceptedGraph, strippedPathCount } = repairableWithoutRetry
      ? stripUnknownNodePaths(graph, params.fileTreeLookup)
      : { graph, strippedPathCount: 0 };
    const accepted = graphValidation.valid || repairableWithoutRetry;

    const attemptAudit = {
      attempt,
      rawOutput: rawText,
      graph: acceptedGraph,
      validationFeedback: accepted
        ? undefined
        : formatGraphValidationFeedback(graphValidation.issues),
      validationCategories: graphValidation.valid
        ? undefined
        : validationCategories,
      strippedPathCount: strippedPathCount || undefined,
      status: accepted ? "succeeded" : "failed",
      createdAt: new Date().toISOString(),
    } satisfies GraphAttemptAudit;

    audit = withGraphAttempt(audit, attemptAudit);

    if (accepted) {
      if (strippedPathCount) {
        console.info(
          JSON.stringify({
            event: "generate.graph.paths_stripped",
            session_id: params.sessionId,
            attempt,
            stripped_path_count: strippedPathCount,
          }),
        );
      }
      return {
        ok: true,
        audit: withGraph(audit, acceptedGraph),
        graph: acceptedGraph,
      };
    }

    validationFeedback = formatGraphValidationFeedback(graphValidation.issues);
    previousGraphRaw = rawText;
    audit = withTimelineEvent(
      audit,
      "graph_validating",
      `Graph validation failed on attempt ${attempt}/${MAX_GRAPH_ATTEMPTS}.`,
    );
    void params.send({
      status: "graph_validating",
      session_id: params.sessionId,
      message: `Graph validation failed on attempt ${attempt}/${MAX_GRAPH_ATTEMPTS}.`,
      validation_error: validationFeedback,
      graph_attempts: audit.graphAttempts,
    });
  }

  return {
    ok: false,
    audit,
    validationError:
      validationFeedback ??
      "Graph generation failed validation after the maximum number of attempts.",
  };
}
