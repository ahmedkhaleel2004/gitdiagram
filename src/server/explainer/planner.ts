import "server-only";

import { readIntEnv } from "~/server/env";
import { errorText, logEvent } from "~/server/log";
import type { Effort, Planner } from "./director";

// Which model makes a video. Claude Opus tells the better story (see
// experiments/video-models), so it writes every script, and GPT-6 Sol designs
// the scenes, which blind-judged about level with Opus designing (see
// experiments/video-bespoke). Premium films go where the most people will
// watch:
// - the operator's videos,
// - popular repositories, whoever asks (VIDEO_PREMIUM_MIN_STARS),
// - a priority visitor's first video of the day (takePremiumVideo).
// They are made the same way unless VIDEO_PREMIUM_OPUS_DESIGNS=1, which has
// Opus design them too. A visitor let in from a limited country
// (features/admin/limited-countries.ts) always gets the standard planner, even
// for a popular repository.

/** GPT models run on OpenAI; every other model on the Claude API. */
export const isOpenAIModel = (model: string) => /^gpt-/i.test(model);

/** Whether the API key the model's provider needs is set. */
export function hasKeyFor(model: string): boolean {
  const key = isOpenAIModel(model)
    ? process.env.OPENAI_API_KEY
    : process.env.ANTHROPIC_API_KEY;
  return Boolean(key?.trim());
}

function readEffort(name: string, fallback: Effort): Effort {
  const value = process.env[name]?.trim();
  return value === "low" || value === "medium" || value === "high"
    ? value
    : fallback;
}

/** The standard films' designer, and the model that stands in for Opus. */
function standardDesigner() {
  return {
    model: process.env.VIDEO_STANDARD_MODEL?.trim() || "gpt-6-sol",
    effort: readEffort("VIDEO_STANDARD_EFFORT", "medium"),
  };
}

/**
 * Claude Opus writes the script and GPT-6 Sol designs the scenes. With
 * VIDEO_PREMIUM_OPUS_DESIGNS=1, Opus designs too; when it then fails for any
 * reason but a refusal (out of credit, overloaded), the standard designer
 * takes over both roles if its key is set, so the film is still made.
 */
export function premiumPlanner(): Planner {
  const model = process.env.VIDEO_PLANNER_MODEL?.trim() || "claude-opus-5-5";
  const effort = readEffort("VIDEO_PLANNER_EFFORT", "low");
  const sol = standardDesigner();
  if (sol.model === model) return { model, effort };
  if (process.env.VIDEO_PREMIUM_OPUS_DESIGNS?.trim() !== "1")
    return { model, effort, designer: sol };
  return { model, effort, ...(hasKeyFor(sol.model) ? { fallback: sol } : {}) };
}

/**
 * Claude Opus writes the script (one call, where the story is made) and
 * GPT-6 Sol at medium effort designs the scenes. Blind-judged about level
 * with Opus alone and faster than Sol alone (see experiments/video-bespoke).
 * VIDEO_STANDARD_DIRECTOR_MODEL set to the standard model makes Sol do both.
 * When the director fails (but not on a refusal), Sol writes the script too.
 */
function standardPlanner(): Planner {
  const designer = standardDesigner();
  const director =
    process.env.VIDEO_STANDARD_DIRECTOR_MODEL?.trim() || "claude-opus-5-5";
  if (director === designer.model) return designer;
  return {
    model: director,
    effort: readEffort("VIDEO_PLANNER_EFFORT", "low"),
    designer,
  };
}

/** Every model a video may be made with, for checking their keys. */
export function plannerModels(): string[] {
  return [premiumPlanner(), standardPlanner()].flatMap((planner) => [
    planner.model,
    ...(planner.designer ? [planner.designer.model] : []),
  ]);
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
  /** Never the premium planner (a visitor from a limited country). */
  standardOnly?: boolean;
  takePremium: () => Promise<{ refund: () => Promise<void> } | null>;
}): Promise<PlannerChoice> {
  if (params.operator) return { planner: premiumPlanner() };
  if (params.standardOnly) return { planner: standardPlanner() };
  if (params.stars >= readIntEnv("VIDEO_PREMIUM_MIN_STARS", 10_000))
    return { planner: premiumPlanner() };
  if (params.priority) {
    // Without Redis the visitor gets the standard model, never a free premium one.
    const taken = await params.takePremium().catch((error: unknown) => {
      logEvent("error", "video.premium.take_failed", {
        error: errorText(error),
      });
      return null;
    });
    if (taken) return { planner: premiumPlanner(), refund: taken.refund };
  }
  return { planner: standardPlanner() };
}
