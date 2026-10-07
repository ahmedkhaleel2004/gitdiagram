import "server-only";

import { readIntEnv } from "~/server/env";
import { errorText, logEvent } from "~/server/log";
import type { Effort, Planner } from "./director";

// Which model makes a video. Claude Opus tells the better story (see
// experiments/video-models), so it writes every script, and Claude Haiku 5.5
// at medium effort designs the scenes: blind-judged level with GPT-6.1 Sol at
// under a third of the price (see experiments/video-haiku-designer). Sol
// stands behind both, so films are still made when the Claude API fails or
// its credit runs out. Premium films go where the most people will watch:
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

/** The films' scene designer. */
function standardDesigner() {
  return {
    model: process.env.VIDEO_STANDARD_MODEL?.trim() || "claude-haiku-5-5",
    effort: readEffort("VIDEO_STANDARD_EFFORT", "medium"),
  };
}

/**
 * GPT-6.1 Sol (VIDEO_FALLBACK_MODEL), when `model` is on the other provider
 * and Sol's key is set: what fails one Claude model (no credit, an outage)
 * usually fails the others too.
 */
function otherProvider(model: string) {
  const fallback = {
    model: process.env.VIDEO_FALLBACK_MODEL?.trim() || "gpt-6.1-sol",
    effort: readEffort("VIDEO_FALLBACK_EFFORT", "medium"),
  };
  return isOpenAIModel(fallback.model) !== isOpenAIModel(model) &&
    hasKeyFor(fallback.model)
    ? fallback
    : undefined;
}

/**
 * A designer on the director's own provider leaves nobody to make the film
 * when that provider fails, so the other provider's model stands behind both.
 */
function withProviderFallback(planner: Planner): Planner {
  const { designer } = planner;
  if (
    !designer ||
    isOpenAIModel(designer.model) !== isOpenAIModel(planner.model)
  )
    return planner;
  const fallback = otherProvider(planner.model);
  return fallback ? { ...planner, fallback } : planner;
}

/**
 * Claude Opus writes the script and the standard designer designs the scenes.
 * With VIDEO_PREMIUM_OPUS_DESIGNS=1, Opus designs too; when it then fails for
 * any reason but a refusal (out of credit, overloaded), the other provider's
 * model takes over both roles if its key is set, so the film is still made.
 */
export function premiumPlanner(): Planner {
  const model = process.env.VIDEO_PLANNER_MODEL?.trim() || "claude-opus-5-5";
  const effort = readEffort("VIDEO_PLANNER_EFFORT", "low");
  const designer = standardDesigner();
  if (designer.model === model) return { model, effort };
  if (process.env.VIDEO_PREMIUM_OPUS_DESIGNS?.trim() !== "1")
    return withProviderFallback({ model, effort, designer });
  const fallback =
    isOpenAIModel(designer.model) !== isOpenAIModel(model) &&
    hasKeyFor(designer.model)
      ? designer
      : otherProvider(model);
  return { model, effort, ...(fallback ? { fallback } : {}) };
}

/**
 * Claude Opus writes the script (one call, where the story is made) and the
 * standard designer designs the scenes. VIDEO_STANDARD_DIRECTOR_MODEL set to
 * the standard model makes that model do both. When the director fails (but
 * not on a refusal), the other provider's model writes the script too.
 */
function standardPlanner(): Planner {
  const designer = standardDesigner();
  const director =
    process.env.VIDEO_STANDARD_DIRECTOR_MODEL?.trim() || "claude-opus-5-5";
  if (director === designer.model) return designer;
  return withProviderFallback({
    model: director,
    effort: readEffort("VIDEO_PLANNER_EFFORT", "low"),
    designer,
  });
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
