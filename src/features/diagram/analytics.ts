import type { RepositoryVisibility } from "~/features/diagram/types";
import { captureAnalyticsEvent } from "~/lib/analytics-client";

type Properties = Record<string, boolean | number | string | null>;

export type DiagramEvent =
  | "diagram_viewed"
  | "diagram_generation_started"
  | "diagram_generated"
  | "diagram_failed"
  | "diagram_render_failed";

/**
 * The repository name to report: only once it is known to be public. A private
 * repository (or one not yet confirmed public) is reported as null.
 */
export function reportableRepo(
  repository: string,
  visibility: RepositoryVisibility | undefined,
): string | null {
  return visibility === "public" ? repository : null;
}

/** Reports a diagram event; never throws into the flow it is called from. */
export function captureDiagramEvent(
  name: DiagramEvent,
  properties: Properties,
) {
  try {
    captureAnalyticsEvent(name, properties);
  } catch (error) {
    console.error("Diagram analytics failed", error);
  }
}
