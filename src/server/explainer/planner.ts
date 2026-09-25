import "server-only";

import {
  hasStandardPlanner,
  premiumPlanner,
  standardPlanner,
  type Planner,
} from "./director";

// Which model makes a video. Claude Opus tells the better story (see
// experiments/video-models), so it goes where the most people will watch:
// - the operator's videos,
// - popular repositories, whoever asks (VIDEO_PREMIUM_MIN_STARS),
// - a priority visitor's first video of the day (takePremiumVideo).
// Every other video is made with GPT-6 Sol, which is close behind.

function minStars(): number {
  const parsed = Number.parseInt(
    process.env.VIDEO_PREMIUM_MIN_STARS?.trim() ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10_000;
}

export interface PlannerChoice {
  planner: Planner;
  /** Gives back the visitor's premium video if the run fails for free. */
  refund?: () => Promise<void>;
}

export async function choosePlanner(params: {
  operator: boolean;
  stars: number;
  priority: boolean;
  takePremium: () => Promise<{ refund: () => Promise<void> } | null>;
}): Promise<PlannerChoice> {
  if (params.operator || params.stars >= minStars() || !hasStandardPlanner())
    return { planner: premiumPlanner() };
  if (params.priority) {
    // Without Redis the visitor gets the standard model, never a free premium one.
    const taken = await params.takePremium().catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: "video.premium.take_failed",
          error:
            error instanceof Error ? error.message.slice(0, 200) : "unknown",
        }),
      );
      return null;
    });
    if (taken) return { planner: premiumPlanner(), refund: taken.refund };
  }
  return { planner: standardPlanner() };
}
