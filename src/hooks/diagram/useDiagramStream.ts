import { useCallback, useState } from "react";

import { streamDiagramGeneration } from "~/features/diagram/api";
import type {
  DiagramStreamMessage,
  DiagramStreamState,
} from "~/features/diagram/types";
import { getStoredOpenAiKey } from "~/lib/openai-key";

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
  onError: (message: string) => void;
}

export function useDiagramStream({
  username,
  repo,
  initialState,
  onComplete,
  onError,
}: UseDiagramStreamOptions) {
  const [state, setState] = useState<DiagramStreamState>(
    initialState ?? { status: "idle" },
  );

  const handleStreamMessage = useCallback(
    async (
      data: DiagramStreamMessage,
      buffers: {
        explanation: string;
      },
    ) => {
      if (data.error) {
        setState({
          status: "error",
          sessionId: data.session_id,
          costSummary: data.cost_summary,
          quotaResetAt: data.quota_reset_at,
          error: data.error,
          errorCode: data.error_code,
          validationError: data.validation_error,
          failureStage: data.failure_stage,
          latestSessionAudit: data.latest_session_audit,
        });
        onError(data.error);
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
          setState((prev) => ({
            ...prev,
            status: data.status,
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
            setState((prev) => ({
              ...prev,
              status: "explanation_chunk",
              sessionId: data.session_id ?? prev.sessionId,
              costSummary: data.cost_summary ?? prev.costSummary,
              quotaResetAt: data.quota_reset_at ?? prev.quotaResetAt,
              explanation: buffers.explanation,
            }));
          }
          break;
        case "complete": {
          const explanation = data.explanation ?? buffers.explanation;
          const diagram = data.diagram ?? "";
          setState({
            status: "complete",
            sessionId: data.session_id,
            costSummary: data.cost_summary,
            quotaResetAt: data.quota_reset_at,
            explanation,
            diagram,
            graph: data.graph,
            graphAttempts: data.graph_attempts,
            latestSessionAudit: data.latest_session_audit,
          });
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
          setState({
            status: "error",
            sessionId: data.session_id,
            costSummary: data.cost_summary,
            quotaResetAt: data.quota_reset_at,
            error: data.error,
            validationError: data.validation_error,
            failureStage: data.failure_stage,
            latestSessionAudit: data.latest_session_audit,
          });
          if (data.error) onError(data.error);
          return false;
      }

      return true;
    },
    [onComplete, onError],
  );

  const runGeneration = useCallback(
    async (githubPat?: string) => {
      setState({
        status: "started",
        message: "Starting generation process...",
        costSummary: undefined,
      });
      const buffers = {
        explanation: "",
      };

      await streamDiagramGeneration(
        {
          username,
          repo,
          apiKey: getStoredOpenAiKey(),
          githubPat,
        },
        {
          onMessage: (message) => handleStreamMessage(message, buffers),
        },
      );
    },
    [handleStreamMessage, repo, username],
  );

  return {
    state,
    runGeneration,
    setState,
  };
}
