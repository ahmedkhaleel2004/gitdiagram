import type { DiagramStreamStatus } from "~/features/diagram/types";

export function generationStep(status: DiagramStreamStatus): number {
  if (["explanation_sent", "explanation", "explanation_chunk"].includes(status))
    return 1;
  if (
    [
      "graph_sent",
      "graph",
      "graph_retry",
      "graph_validating",
      "diagram_compiling",
      "complete",
    ].includes(status)
  )
    return 2;
  return 0;
}
