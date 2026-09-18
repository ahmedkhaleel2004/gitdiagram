"use client";

import { useCallback, useState } from "react";
import type { DiagramStreamState } from "~/features/diagram/types";

import {
  diagramPresentation,
  type PresentedDiagram,
} from "./diagram-presentation";

// Keep the last successfully rendered result across a new stream, cancellation,
// or render failure. A new run must report its own render even for identical text.
export function useDiagramPresentation(
  state: DiagramStreamState,
  loading: boolean,
  lastGenerated: Date | undefined,
  onRenderError: (message: string) => void,
) {
  const [presented, setPresented] = useState<PresentedDiagram>();
  const [failedKey, setFailedKey] = useState<string>();
  const presentation = diagramPresentation(
    state,
    loading,
    presented,
    failedKey,
  );
  const { candidateKey } = presentation;
  const complete = useCallback(() => {
    if (!candidateKey || !state.diagram || candidateKey === failedKey) return;
    setPresented((previous) =>
      previous?.key === candidateKey
        ? previous
        : {
            key: candidateKey,
            diagram: state.diagram!,
            state,
            lastGenerated,
          },
    );
  }, [candidateKey, failedKey, lastGenerated, state]);
  const fail = useCallback(
    (message: string) => {
      setFailedKey(candidateKey);
      onRenderError(message);
    },
    [candidateKey, onRenderError],
  );
  return { presented, ...presentation, complete, fail };
}
