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
import { generateStructuredOutput, streamStructuredOutput } from "./openai";
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
  readme: string;
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
      explanation: string;
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
    let graph: DiagramGraph;
    let rawText: string;
    let usage: GenerationTokenUsage | null = null;
    let finalExplanation = "";

    if (attempt === 1) {
      const streamStartedAt = performance.now();
      const { stream, usagePromise } = await streamStructuredOutput({
        provider: params.provider,
        model: params.model,
        systemPrompt: SYSTEM_GRAPH_PROMPT,
        userPrompt: toTaggedMessage({
          file_tree: params.fileTree,
          readme: params.readme,
        }),
        schema: diagramGraphSchema,
        schemaName: "diagram_graph",
        apiKey: params.apiKey,
        reasoningEffort: GRAPH_REASONING_EFFORT,
        textVerbosity: GRAPH_TEXT_VERBOSITY,
        maxOutputTokens: GRAPH_MAX_OUTPUT_TOKENS,
        signal: params.signal,
        clientRequestId: `${params.sessionId}:graph:${attempt}`,
      });

      let accumulatedText = "";
      let explanationStreamedLength = 0;
      let recordedFirstChunk = false;

      for await (const chunk of stream) {
        params.signal.throwIfAborted();
        accumulatedText += chunk;

        if (!recordedFirstChunk) {
          params.recordTiming(`graph_attempt_1_first_chunk`, streamStartedAt);
          recordedFirstChunk = true;
        }

        const startMatch = accumulatedText.match(/"explanation"\s*:\s*"/);
        if (startMatch) {
          const startIndex = startMatch.index! + startMatch[0].length;
          let endQuoteIndex = -1;
          let escaped = false;
          for (let i = startIndex; i < accumulatedText.length; i++) {
            if (escaped) {
              escaped = false;
            } else if (accumulatedText[i] === '\\') {
              escaped = true;
            } else if (accumulatedText[i] === '"') {
              endQuoteIndex = i;
              break;
            }
          }

          const currentEnd = endQuoteIndex !== -1 ? endQuoteIndex : accumulatedText.length - (escaped ? 1 : 0);
          if (currentEnd > startIndex) {
            const currentExplanationRaw = accumulatedText.substring(startIndex, currentEnd);
            try {
              const parsed = JSON.parse(`"${currentExplanationRaw}"`);
              const newChunk = parsed.substring(explanationStreamedLength);
              if (newChunk) {
                explanationStreamedLength += newChunk.length;
                finalExplanation = parsed;
                void params.send({
                  status: "explanation_chunk",
                  session_id: params.sessionId,
                  chunk: newChunk,
                });
              }
            } catch {
              // wait for more chunks to form valid JSON string
            }
          }
        }
      }

      rawText = accumulatedText;
      try {
        const parsed = JSON.parse(rawText);
        graph = diagramGraphSchema.parse(parsed);
      } catch (error) {
        throw new Error("Structured output stream returned invalid JSON or schema: " + (error instanceof Error ? error.message : "Unknown"));
      }
      usage = await usagePromise;
    } else {
      const result = await generateStructuredOutput({
        provider: params.provider,
        model: params.model,
        systemPrompt: SYSTEM_GRAPH_PROMPT,
        userPrompt: toTaggedMessage({
          file_tree: params.fileTree,
          readme: params.readme,
          previous_graph: previousGraphRaw,
          validation_feedback: validationFeedback,
        }),
        schema: diagramGraphSchema,
        schemaName: "diagram_graph",
        apiKey: params.apiKey,
        reasoningEffort: GRAPH_REASONING_EFFORT,
        textVerbosity: GRAPH_TEXT_VERBOSITY,
        maxOutputTokens: GRAPH_MAX_OUTPUT_TOKENS,
        signal: params.signal,
        clientRequestId: `${params.sessionId}:graph:${attempt}`,
      });
      graph = result.output;
      rawText = result.rawText;
      usage = result.usage;
      finalExplanation = graph.explanation ?? "";
    }
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
        explanation: finalExplanation,
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
