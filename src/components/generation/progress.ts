import type { DiagramStreamStatus } from "~/features/diagram/types";

export const GENERATION_STEPS = [
  "Read source",
  "Analyze",
  "Build diagram",
] as const;

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

export function generationCopy(status: DiagramStreamStatus) {
  switch (status) {
    case "idle":
      return {
        title: "Opening diagram",
        description: "Checking for a saved diagram.",
      };
    case "started":
      return {
        title: "Reading repository",
        description: "Gathering the README, file tree, and source files.",
      };
    case "explanation_sent":
    case "explanation":
    case "explanation_chunk":
      return {
        title: "Analyzing repository",
        description: "Understanding the components and how they connect.",
      };
    case "graph_retry":
      return {
        title: "Refining the diagram",
        description: "Checking the connections and resolving inconsistencies.",
      };
    case "graph_validating":
    case "diagram_compiling":
    case "complete":
      return {
        title: "Drawing your diagram",
        description:
          "Arranging the components and preparing the interactive view.",
      };
    default:
      return {
        title: "Building your diagram",
        description:
          "Turning the architecture into components and connections.",
      };
  }
}
