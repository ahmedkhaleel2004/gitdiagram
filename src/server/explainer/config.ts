import "server-only";

import { isNarrationConfigured } from "./narration";
import { hasKeyFor, plannerModels } from "./planner";

/** Explainer videos stay off unless a deployment opts in. */
export function isVideoExplainerEnabled(): boolean {
  return process.env.VIDEO_EXPLAINER_ENABLED === "1";
}

/** Every configured model's provider key is set, and the narrator's too. */
export function canGenerateVideos(): boolean {
  return plannerModels().every(hasKeyFor) && isNarrationConfigured();
}
