import "server-only";

import { isNarrationConfigured } from "./narration";
import { videoPlannerBackend } from "./planner";

/** Explainer videos stay off unless a deployment opts in. */
export function isVideoExplainerEnabled(): boolean {
  return process.env.VIDEO_EXPLAINER_ENABLED === "1";
}

export function canGenerateVideos(): boolean {
  return videoPlannerBackend() !== null && isNarrationConfigured();
}
