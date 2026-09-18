import type { DiagramStreamState } from "~/features/diagram/types";
import { githubAccessTitle } from "~/features/diagram/github-access";
import { generationStep } from "./progress";

function generationTitle(state: DiagramStreamState) {
  if (state.status === "idle") return "Opening your diagram";
  if (state.status === "started")
    return state.lastActivityAt
      ? "Reading the repository"
      : "Connecting to your repository";
  if (generationStep(state.status) === 1)
    return "Understanding the architecture";
  if (state.status === "graph_retry") return "Refining the connections";
  if (state.status === "diagram_compiling" || state.status === "complete")
    return "Drawing your diagram";
  return "Mapping the connections";
}

export function feedbackState(
  state: DiagramStreamState,
  active: boolean,
  renderFailed: boolean,
  seconds: number,
  now: number,
) {
  const failed = state.status === "error" || renderFailed;
  const cancelled = state.errorCode === "GENERATION_CANCELLED";
  const rendering =
    state.status === "diagram_compiling" || state.status === "complete";
  const quiet =
    active &&
    !rendering &&
    (state.lastActivityAt !== undefined
      ? now - state.lastActivityAt > 25_000
      : seconds > 25);
  if (failed)
    return {
      failed,
      cancelled,
      quiet,
      title: cancelled
        ? "Generation stopped"
        : renderFailed
          ? "Couldn’t display the diagram"
          : (githubAccessTitle(state.errorCode) ??
            "Couldn’t generate the diagram"),
      description: cancelled ? "" : state.error,
    };
  return {
    failed,
    cancelled,
    quiet,
    title: quiet ? "Waiting for an update" : generationTitle(state),
    description: quiet
      ? "No recent updates from the server."
      : seconds >= 20 && state.lastActivityAt && !rendering
        ? "Still working · receiving updates"
        : "",
  };
}
