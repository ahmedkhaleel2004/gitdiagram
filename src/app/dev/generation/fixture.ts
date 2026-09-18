import type { DiagramStreamState } from "~/features/diagram/types";
import type { DiagramGraph } from "~/features/diagram/graph";

export const DEMO_REPOSITORY = "ahmedkhaleel2004/gitdiagram";
const DEMO_NOTES = `## A repository-to-diagram pipeline
GitDiagram turns a GitHub repository into an interactive architecture map. The main flow moves from a **Next.js interface**, through repository analysis, to a diagram you can explore.

## The user-facing application
The pages in \`src/app\` accept a repository URL and load a saved diagram when one exists. Otherwise, \`useDiagram\` starts a new generation and streams updates into the interface.

## Understanding the repository
The server gathers the **README, file structure, and selected source files** from GitHub. The generation pipeline uses this context to identify the main components, their responsibilities, and how they relate to each other.

## From architecture to a graph
The analysis becomes a structured graph of components and connections. Validation checks the graph before it is compiled into Mermaid. If a check fails, the pipeline can refine the graph and try again.

## Drawing and saving the result
The browser renders the diagram with **Mermaid**. Users can zoom, pan, follow repository links, and export an image. Storage keeps successful diagrams available for future visits.

## The big picture
Three parts work together: the **web interface**, the **generation pipeline**, and the **storage layer**. The streamed response connects them, keeping the user informed from the first request to the finished map.`;

const nodes = [
  ["web", "Web interface", "src/app"],
  ["stream", "Streaming API", "src/app/api/generate"],
  ["github", "Repository context", null],
  ["analysis", "Architecture analysis", null],
  ["graph", "Graph generation", null],
  ["validate", "Validate & compile", null],
  ["storage", "Saved diagrams", null],
  ["mermaid", "Interactive diagram", "src/components/mermaid-diagram.tsx"],
] as const;
const edges = [
  ["web", "stream"],
  ["github", "analysis"],
  ["stream", "analysis"],
  ["analysis", "graph"],
  ["graph", "validate"],
  ["validate", "storage"],
  ["validate", "mermaid"],
  ["storage", "web"],
] as const;
export const DEMO_GRAPH: DiagramGraph = {
  groups: [],
  nodes: nodes.map(([id, label, path]) => ({
    id,
    label,
    path,
    type: "component",
    description: null,
    groupId: null,
    shape: "box",
  })),
  edges: edges.map(([from, to]) => ({
    from,
    to,
    label: null,
    description: null,
    style: "solid",
  })),
};
export const DEMO_DIAGRAM = `flowchart LR
  web["Web interface"] --> stream["Streaming API"]
  subgraph pipeline["Generation pipeline"]
    analysis["Architecture analysis"] --> graph_node["Graph generation"] --> validate["Validate & compile"]
  end
  stream --> analysis
  github["Repository context"] --> analysis
  validate --> storage[("Saved diagrams")]
  validate --> mermaid["Interactive diagram"]
  storage --> web
  classDef default fill:#f5f0fb,stroke:#ab96bf,stroke-width:1px,color:#382c46,rx:8,ry:8
  classDef ui fill:#e9dcfa,stroke:#a48abc,stroke-width:1px,color:#382c46,rx:8,ry:8
  classDef data fill:#f4e9d5,stroke:#c7af86,stroke-width:1px,color:#514329,rx:8,ry:8
  class web,mermaid ui
  class github,storage data
  style pipeline fill:#eee8f480,stroke:#cbbbd9,stroke-width:1px,rx:12,ry:12
  linkStyle default stroke:#a697b6,stroke-width:1.2px
`;

export const DEMO_PREVIOUS_DIAGRAM = `flowchart LR
  web["Web interface"] --> api["Generation API"]
  api --> context["Repository context"]
  context --> diagram["Diagram renderer"]
  api --> storage[("Saved diagrams")]
  storage --> web
  classDef default fill:#f5f0fb,stroke:#ab96bf,stroke-width:1px,color:#382c46,rx:8,ry:8
  classDef ui fill:#e9dcfa,stroke:#a48abc,stroke-width:1px,color:#382c46,rx:8,ry:8
  class web,diagram ui
  linkStyle default stroke:#a697b6,stroke-width:1.2px
`;

export type DemoScenario =
  | "normal"
  | "slow"
  | "retry"
  | "error"
  | "stalled"
  | "regenerate"
  | "regenerate-error";
export function demoDuration(scenario: DemoScenario) {
  return scenario === "stalled"
    ? 90
    : scenario === "slow"
      ? 81
      : scenario === "retry"
        ? 34
        : 26;
}
export function demoState(
  seconds: number,
  scenario: DemoScenario,
): DiagramStreamState {
  if (scenario === "stalled" && seconds >= 3)
    return seconds < 90
      ? { status: "explanation" }
      : {
          status: "error",
          error:
            "The connection ended before the diagram was complete. Please try again.",
          errorCode: "STREAM_FAILED",
        };
  const time =
    scenario === "slow" && seconds > 3 ? Math.max(3, seconds - 55) : seconds;
  if (time < 1) return { status: "idle" };
  if (time < 3) return { status: "started" };
  if (time < 5) return { status: "explanation_sent" };
  if (time < 16)
    return {
      status: "explanation_chunk",
      explanation: DEMO_NOTES.slice(
        0,
        Math.floor(DEMO_NOTES.length * Math.min(1, (time - 5) / 9)),
      ),
    };
  if ((scenario === "error" || scenario === "regenerate-error") && time >= 20)
    return {
      status: "error",
      explanation: DEMO_NOTES,
      error:
        "The connection ended before the diagram was complete. Please try again.",
      errorCode: "STREAM_FAILED",
    };
  if (time < 23) return { status: "graph_sent", explanation: DEMO_NOTES };
  if (scenario === "retry" && time < 31)
    return { status: "graph_retry", explanation: DEMO_NOTES };
  if (time < (scenario === "retry" ? 34 : 26))
    return {
      status: "diagram_compiling",
      explanation: DEMO_NOTES,
      graph: DEMO_GRAPH,
    };
  return {
    status: "complete",
    explanation: DEMO_NOTES,
    graph: DEMO_GRAPH,
    diagram: DEMO_DIAGRAM,
  };
}

const DARK_DEMO_COLORS: Record<string, string> = {
  "#f5f0fb": "#302538",
  "#ab96bf": "#695879",
  "#382c46": "#e4daed",
  "#e9dcfa": "#463052",
  "#a48abc": "#8665a4",
  "#f4e9d5": "#443725",
  "#c7af86": "#8e7654",
  "#514329": "#e7d8b7",
  "#eee8f480": "#262030",
  "#cbbbd9": "#564461",
  "#a697b6": "#86758f",
};

export function themedDemoDiagram(diagram: string, dark: boolean) {
  return dark
    ? diagram.replace(
        /#[a-f0-9]{6,8}\b/g,
        (color) => DARK_DEMO_COLORS[color] ?? color,
      )
    : diagram;
}
