import { useCallback, useEffect, useRef, useState } from "react";

import { streamDiagramGeneration } from "~/features/diagram/api";
import type {
  DiagramStreamMessage,
  DiagramStreamState,
} from "~/features/diagram/types";

interface UseDiagramStreamOptions {
  username: string;
  repo: string;
  initialState?: DiagramStreamState;
  onComplete: (result: {
    diagram: string;
    explanation: string;
    graph: DiagramStreamState["graph"];
    latestSessionAudit: DiagramStreamState["latestSessionAudit"];
    generatedAt?: string;
  }) => Promise<void>;
}

export function useDiagramStream({
  username,
  repo,
  initialState,
  onComplete,
}: UseDiagramStreamOptions) {
  const [state, setState] = useState<DiagramStreamState>(
    initialState ?? { status: "idle" },
  );
  const activeGenerationRef = useRef<AbortController | null>(null);
  const explanationFrameRef = useRef<number | null>(null);
  const pendingExplanationRef = useRef<{
    explanation: string;
    message: DiagramStreamMessage;
  } | null>(null);

  const flushPendingExplanation = useCallback(() => {
    if (explanationFrameRef.current !== null) {
      cancelAnimationFrame(explanationFrameRef.current);
      explanationFrameRef.current = null;
    }

    const pending = pendingExplanationRef.current;
    pendingExplanationRef.current = null;
    if (!pending) return;

    setState((prev) => ({
      ...prev,
      status: "explanation_chunk",
      sessionId: pending.message.session_id ?? prev.sessionId,
      costSummary: pending.message.cost_summary ?? prev.costSummary,
      quotaResetAt: pending.message.quota_reset_at ?? prev.quotaResetAt,
      explanation: pending.explanation,
    }));
  }, []);

  const scheduleExplanationUpdate = useCallback(
    (explanation: string, message: DiagramStreamMessage) => {
      pendingExplanationRef.current = { explanation, message };
      if (explanationFrameRef.current !== null) return;

      explanationFrameRef.current = requestAnimationFrame(() => {
        explanationFrameRef.current = null;
        flushPendingExplanation();
      });
    },
    [flushPendingExplanation],
  );

  useEffect(
    () => () => {
      activeGenerationRef.current?.abort();
      activeGenerationRef.current = null;
      if (explanationFrameRef.current !== null) {
        cancelAnimationFrame(explanationFrameRef.current);
      }
      explanationFrameRef.current = null;
      pendingExplanationRef.current = null;
    },
    [],
  );

  const handleStreamMessage = useCallback(
    async (
      data: DiagramStreamMessage,
      buffers: {
        explanation: string;
      },
    ) => {
      if (data.error) {
        flushPendingExplanation();
        setState((prev) => ({
          ...prev,
          status: "error",
          sessionId: data.session_id,
          costSummary: data.cost_summary,
          quotaResetAt: data.quota_reset_at,
          error: data.error,
          errorCode: data.error_code,
          validationError: data.validation_error,
          failureStage: data.failure_stage,
          latestSessionAudit: data.latest_session_audit,
        }));
        return false;
      }

      switch (data.status) {
        case "started":
        case "explanation_sent":
        case "explanation":
        case "graph_sent":
        case "graph":
        case "graph_retry":
        case "graph_validating":
        case "diagram_compiling":
          flushPendingExplanation();
          if (data.explanation !== undefined)
            buffers.explanation = data.explanation;
          setState((prev) => ({
            ...prev,
            status: data.status,
            explanation: data.explanation ?? prev.explanation,
            sourceFileCount: data.source_file_count ?? prev.sourceFileCount,
            sessionId: data.session_id ?? prev.sessionId,
            message: data.message,
            costSummary: data.cost_summary ?? prev.costSummary,
            quotaResetAt: data.quota_reset_at ?? prev.quotaResetAt,
            graph: data.graph ?? prev.graph,
            graphAttempts: data.graph_attempts ?? prev.graphAttempts,
            diagram: data.diagram ?? prev.diagram,
            validationError: data.validation_error ?? prev.validationError,
            failureStage: data.failure_stage ?? prev.failureStage,
          }));
          break;
        case "explanation_chunk":
          if (data.chunk) {
            buffers.explanation += data.chunk;
            scheduleExplanationUpdate(buffers.explanation, data);
          }
          break;
        case "complete": {
          flushPendingExplanation();
          const explanation = data.explanation ?? buffers.explanation;
          const diagram = data.diagram ?? "";
          setState((prev) => ({
            status: "complete",
            startedAt: prev.startedAt,
            lastActivityAt: prev.lastActivityAt,
            sourceFileCount: prev.sourceFileCount,
            sessionId: data.session_id,
            costSummary: data.cost_summary,
            quotaResetAt: data.quota_reset_at,
            explanation,
            diagram,
            graph: data.graph,
            graphAttempts: data.graph_attempts,
            latestSessionAudit: data.latest_session_audit,
            persistenceWarning: data.persistence_warning,
          }));
          await onComplete({
            explanation,
            diagram,
            graph: data.graph,
            latestSessionAudit: data.latest_session_audit,
            generatedAt: data.generated_at,
          });
          return false;
        }
        case "error":
          flushPendingExplanation();
          setState((prev) => ({
            ...prev,
            status: "error",
            sessionId: data.session_id,
            costSummary: data.cost_summary,
            quotaResetAt: data.quota_reset_at,
            error: data.error,
            errorCode: data.error_code,
            validationError: data.validation_error,
            failureStage: data.failure_stage,
            latestSessionAudit: data.latest_session_audit,
          }));
          return false;
      }

      return true;
    },
    [flushPendingExplanation, onComplete, scheduleExplanationUpdate],
  );

  const runGeneration = useCallback(async () => {
    activeGenerationRef.current?.abort();
    if (explanationFrameRef.current !== null) {
      cancelAnimationFrame(explanationFrameRef.current);
      explanationFrameRef.current = null;
    }
    pendingExplanationRef.current = null;
    const abortController = new AbortController();
    activeGenerationRef.current = abortController;
    setState({
      status: "started",
      startedAt: Date.now(),
      message: "Starting generation process...",
      costSummary: undefined,
    });
    const buffers = {
      explanation: "",
    };
    let lastActivityUpdate = 0;

    try {
      await streamDiagramGeneration(
        {
          username,
          repo,
          signal: abortController.signal,
        },
        {
          onActivity: () => {
            if (activeGenerationRef.current !== abortController) return;
            const now = Date.now();
            if (now - lastActivityUpdate < 1000) return;
            lastActivityUpdate = now;
            setState((prev) => ({ ...prev, lastActivityAt: now }));
          },
          onMessage: (message) =>
            activeGenerationRef.current === abortController
              ? handleStreamMessage(message, buffers)
              : false,
        },
      );
    } catch (error) {
      if (!abortController.signal.aborted) {
        throw error;
      }
    } finally {
      if (activeGenerationRef.current === abortController) {
        activeGenerationRef.current = null;
      }
    }
  }, [handleStreamMessage, repo, username]);

  const cancelGeneration = useCallback(() => {
    activeGenerationRef.current?.abort();
    activeGenerationRef.current = null;
    if (explanationFrameRef.current !== null) {
      cancelAnimationFrame(explanationFrameRef.current);
      explanationFrameRef.current = null;
    }
    pendingExplanationRef.current = null;
    setState((prev) => ({
      ...prev,
      status: "error",
      errorCode: "GENERATION_CANCELLED",
      error:
        "You stopped this generation. You can start again whenever you’re ready.",
    }));
  }, []);

  return {
    state,
    runGeneration,
    cancelGeneration,
    setState,
  };
}
