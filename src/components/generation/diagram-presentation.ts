import type { DiagramStreamState } from "~/features/diagram/types";

export interface PresentedDiagram {
  key: string;
  diagram: string;
  state: DiagramStreamState;
  lastGenerated?: Date;
}

export function diagramPresentation(
  state: DiagramStreamState,
  loading: boolean,
  presented?: PresentedDiagram,
  failedKey?: string,
) {
  const candidateKey = state.diagram
    ? `${state.startedAt ?? "stored"}:${state.diagram}`
    : undefined;
  const canRender = Boolean(
    candidateKey &&
    (state.status === "complete" || state.status === "error") &&
    candidateKey !== failedKey,
  );
  const pending = canRender && candidateKey !== presented?.key;
  const renderFailed = Boolean(candidateKey && failedKey === candidateKey);
  const failed = state.status === "error" || renderFailed;
  // Restoring saved Mermaid is a render, not a new generation. Keep the result
  // header in place without briefly replaying its completed activity.
  const restoring = Boolean(
    pending && state.startedAt === undefined && !failed,
  );
  const ready = Boolean(presented && !pending && !loading && !failed);
  const active = !failed && !restoring && (loading || pending);
  const toolbarVisible = Boolean((presented || restoring) && !active);
  const hasGeneration = state.startedAt !== undefined || failed;
  const workVisible = hasGeneration && !ready;
  const opening = !presented && !hasGeneration;
  const announcement = ready
    ? "Diagram ready"
    : opening
      ? "Loading diagram"
      : "";
  const layers: Array<{ key: string; diagram: string }> = [];
  if (presented) layers.push(presented);
  if (pending && candidateKey && state.diagram)
    layers.push({ key: candidateKey, diagram: state.diagram });
  return {
    layers,
    ready,
    active,
    failed,
    toolbarVisible,
    hasGeneration,
    workVisible,
    opening,
    announcement,
    renderFailed,
    candidateKey,
  };
}
