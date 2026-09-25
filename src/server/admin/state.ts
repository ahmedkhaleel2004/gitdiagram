import "server-only";

import type { AdminState } from "~/features/admin/types";
import { readClaudeCredit } from "~/server/admin/claude-credit";
import { readControls } from "~/server/admin/controls";
import {
  createPresenceToken,
  presenceSocketUrl,
} from "~/server/admin/live-events";
import { videoUsageToday } from "~/server/explainer/limits";
import { narrationCreditsRemaining } from "~/server/explainer/narration";
import { readComplimentaryUsageToday } from "~/server/generate/complimentary-gate";

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

/** Everything the dashboard polls: switches, today's budgets, balances. */
export async function readAdminState(): Promise<AdminState> {
  const [controls, video, voiceCredits, claudeCredit, diagramQuota] =
    await Promise.all([
      readControls({ fresh: true }),
      orNull(videoUsageToday()),
      orNull(narrationCreditsRemaining()),
      orNull(readClaudeCredit()),
      orNull(readComplimentaryUsageToday()),
    ]);
  const url = presenceSocketUrl();
  const token = createPresenceToken();
  return {
    now: Date.now(),
    controls,
    video,
    voiceCredits,
    claudeCredit,
    diagramQuota,
    presence: url && token ? { url, token } : null,
    deployment: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
  };
}
