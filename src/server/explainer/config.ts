import "server-only";

import { isNarrationConfigured } from "./narration";

/** Explainer videos stay off unless a deployment opts in. */
export function isVideoExplainerEnabled(): boolean {
  return process.env.VIDEO_EXPLAINER_ENABLED === "1";
}

export function canGenerateVideos(): boolean {
  return (
    Boolean(process.env.ANTHROPIC_API_KEY?.trim()) && isNarrationConfigured()
  );
}
