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
  const ready = Boolean(presented && !pending && !loading && !failed);
  const active = !failed && (loading || pending);
  const layers: Array<{ key: string; diagram: string }> = [];
  if (presented) layers.push(presented);
  if (pending && candidateKey && state.diagram)
    layers.push({ key: candidateKey, diagram: state.diagram });
  return { layers, ready, active, failed, renderFailed, candidateKey };
}
