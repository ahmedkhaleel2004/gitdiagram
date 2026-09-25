import "server-only";

import type { AdminState } from "~/features/admin/types";
import { readClaudeCredit } from "~/server/admin/claude-credit";
import { readControlsForDisplay } from "~/server/admin/controls";
import {
  createPresenceToken,
  presenceSocketUrl,
} from "~/server/admin/live-events";
import { videoUsageToday } from "~/server/explainer/limits";
import * as voice from "~/server/explainer/voice";
import { readComplimentaryUsageToday } from "~/server/generate/complimentary-gate";

// The dashboard polls this every 5 s. The two balances come from outside
// services (OpenRouter, Anthropic) that can be slow, so each gets a short
// deadline of its own and shows as unreadable past it, rather than holding up
// the switches and budgets. A late answer is not wasted: both are cached, so
// the next poll gets it.

const BALANCE_DEADLINE_MS = 3_000;
// OpenRouter's balance moves only as videos are voiced.
const VOICE_CACHE_MS = 30_000;

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

/** Rejects once `ms` pass; the work itself carries on. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Too slow.")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

let voiceCache: { at: number; usd: Promise<number | null> } | null = null;

/** The voice balance, read from OpenRouter at most every half minute. */
function cachedVoiceCredit(now = Date.now()): Promise<number | null> {
  if (!voiceCache || now - voiceCache.at > VOICE_CACHE_MS)
    voiceCache = { at: now, usd: voice.voiceCreditUsd().catch(() => null) };
  return voiceCache.usd;
}

async function claudeCreditState(): Promise<AdminState["claudeCredit"]> {
  try {
    return (await within(readClaudeCredit(), BALANCE_DEADLINE_MS)) ?? "no-key";
  } catch {
    return "unreadable";
  }
}

/** Everything the dashboard polls: switches, today's budgets, balances. */
export async function readAdminState(): Promise<AdminState> {
  const [
    { controls, unreadable: controlsUnreadable },
    video,
    voicePausedUntil,
    voiceCreditUsd,
    claudeCredit,
    diagramQuota,
  ] = await Promise.all([
    readControlsForDisplay({ fresh: true }),
    orNull(videoUsageToday()),
    orNull(voice.voicePausedUntil()),
    orNull(within(cachedVoiceCredit(), BALANCE_DEADLINE_MS)),
    claudeCreditState(),
    orNull(readComplimentaryUsageToday()),
  ]);
  const url = presenceSocketUrl();
  const token = createPresenceToken();
  return {
    now: Date.now(),
    controls,
    controlsUnreadable,
    video,
    voicePausedUntil,
    voiceCreditUsd,
    claudeCredit,
    diagramQuota,
    presence: url && token ? { url, token } : null,
    deployment: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
  };
}
