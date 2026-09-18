import type { DiagramStreamState } from "~/features/diagram/types";
import { generationStep } from "~/components/generation/progress";

export function conceptState({
  stream,
  runId,
  previousDiagram,
  renderedChart,
  renderFailureKey,
  started,
  cancelled,
  stalled,
  seconds,
}: {
  stream: DiagramStreamState;
  runId: number;
  previousDiagram?: string;
  renderedChart?: string;
  renderFailureKey?: string;
  started: boolean;
  cancelled: boolean;
  stalled: boolean;
  seconds: number;
}) {
  const diagram =
    stream.status === "complete" && !cancelled
      ? stream.diagram
      : previousDiagram;
  const renderKey = `${runId}:${diagram ?? ""}`;
  const renderFailed = Boolean(diagram && renderFailureKey === renderKey);
  const ready =
    stream.status === "complete" &&
    renderedChart === renderKey &&
    !cancelled &&
    !renderFailed;
  const failed = stream.status === "error" || cancelled || renderFailed;
  const active = started && !ready && !failed;
  const quiet = active && stalled && seconds > 25;
  const hasPrevious = Boolean(previousDiagram && !ready);
  return {
    diagram,
    renderKey,
    renderFailed,
    ready,
    failed,
    active,
    quiet,
    hasPrevious,
    ...conceptCopy({
      stream,
      seconds,
      started,
      cancelled,
      renderFailed,
      ready,
      quiet,
    }),
  };
}

function stageLabel(status: DiagramStreamState["status"]) {
  if (status === "idle") return "Connecting to your repository";
  if (status === "started") return "Reading the repository";
  if (generationStep(status) === 1) return "Understanding the architecture";
  if (status === "graph_retry") return "Refining the connections";
  if (status === "diagram_compiling" || status === "complete")
    return "Drawing your diagram";
  return "Mapping the connections";
}

export function conceptCopy({
  stream,
  seconds,
  started,
  cancelled,
  renderFailed,
  ready,
  quiet,
}: {
  stream: DiagramStreamState;
  seconds: number;
  started: boolean;
  cancelled: boolean;
  renderFailed: boolean;
  ready: boolean;
  quiet: boolean;
}) {
  if (cancelled)
    return {
      title: "Generation stopped",
      description: "",
    };
  if (renderFailed)
    return {
      title: "Couldn’t display the diagram",
      description: "Try generating it again.",
    };
  if (stream.status === "error")
    return {
      title: "Connection interrupted",
      description: "Try again to restart generation.",
    };
  if (ready)
    return {
      title: "Diagram ready",
      description: `${stream.graph?.nodes.length ?? 8} components · ${stream.graph?.edges.length ?? 8} connections`,
    };
  if (quiet)
    return {
      title: "Waiting for an update",
      description: "No recent updates from the server.",
    };
  if (!started) return { title: "", description: "" };
  const description =
    seconds >= 20 && generationStep(stream.status) < 2
      ? "Still working · receiving updates"
      : seconds >= 3
        ? "12 source files read"
        : "Fetching the README and source files";
  return { title: stageLabel(stream.status), description };
}
