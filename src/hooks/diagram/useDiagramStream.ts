import { useCallback, useState } from "react";

import { streamDiagramGeneration } from "~/features/diagram/api";
import type {
  DiagramStreamMessage,
  DiagramStreamState,
} from "~/features/diagram/types";

interface UseDiagramStreamOptions {
  username: string;
  repo: string;
  onComplete: (result: { diagram: string; explanation: string }) => Promise<void>;
  onError: (message: string) => void;
}

export function useDiagramStream({
  username,
  repo,
  onComplete,
  onError,
}: UseDiagramStreamOptions) {
  const [state, setState] = useState<DiagramStreamState>({ status: "idle" });

  const handleStreamMessage = useCallback(
    async (
      data: DiagramStreamMessage,
      buffers: { explanation: string; mapping: string; diagram: string },
    ) => {
      if (data.error) {
        setState({
          status: "error",
          error: data.error,
          errorCode: data.error_code,
        });
        onError(data.error);
        return false;
      }

      switch (data.status) {
        case "started":
        case "explanation_sent":
        case "explanation":
        case "mapping_sent":
        case "mapping":
        case "diagram_sent":
        case "diagram":
          setState((prev) => ({
            ...prev,
            status: data.status,
            message: data.message,
          }));
          break;
        case "explanation_chunk":
          if (data.chunk) {
            buffers.explanation += data.chunk;
            setState((prev) => ({
              ...prev,
              status: "explanation_chunk",
              explanation: buffers.explanation,
            }));
          }
          break;
        case "mapping_chunk":
          if (data.chunk) {
            buffers.mapping += data.chunk;
            setState((prev) => ({
              ...prev,
              status: "mapping_chunk",
              mapping: buffers.mapping,
            }));
          }
          break;
        case "diagram_chunk":
          if (data.chunk) {
            buffers.diagram += data.chunk;
            setState((prev) => ({
              ...prev,
              status: "diagram_chunk",
              diagram: buffers.diagram,
            }));
          }
          break;
        case "complete": {
          const explanation = data.explanation ?? buffers.explanation;
          const diagram = data.diagram ?? buffers.diagram;
          setState({
            status: "complete",
            explanation,
            diagram,
            mapping: data.mapping ?? buffers.mapping,
          });
          await onComplete({ explanation, diagram });
          return false;
        }
        case "error":
          setState({ status: "error", error: data.error });
          if (data.error) onError(data.error);
          return false;
      }

      return true;
    },
    [onComplete, onError],
  );

  const runGeneration = useCallback(
    async (githubPat?: string) => {
      setState({ status: "started", message: "Starting generation process..." });
      const buffers = { explanation: "", mapping: "", diagram: "" };

      await streamDiagramGeneration(
        {
          username,
          repo,
          apiKey: localStorage.getItem("openai_key") ?? undefined,
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
