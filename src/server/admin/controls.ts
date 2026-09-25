import "server-only";

import type { LiveControls, VideoAudience } from "~/features/admin/types";
import { upstashCommand } from "~/server/storage/upstash";

// Switches the operator flips from /admin while the site is running. They live
// in Redis so every server instance sees a change within a second, with no
// redeploy. Anything unset falls back to the deployment's environment:
// - videoAudience: who may make new videos: the early-access places on any
//   device ("priority"), those plus any desktop, or everyone.
// - videosPaused: stop every new video, whoever asks.
// - videoDailyLimit, videoPersonDailyLimit, videoNetworkDailyLimit: override
//   VIDEO_DAILY_LIMIT, VIDEO_PERSON_DAILY_LIMIT and VIDEO_NETWORK_DAILY_LIMIT.

export const DEFAULT_CONTROLS: LiveControls = {
  videoAudience: "priority",
  videosPaused: false,
  videoDailyLimit: null,
  videoPersonDailyLimit: null,
  videoNetworkDailyLimit: null,
};

const KEY = "admin:v1:controls";
// Long enough that a burst of requests shares one read, short enough that a
// flipped switch reaches every instance within about a second.
const CACHE_MS = 1_000;
const AUDIENCES = new Set<VideoAudience>(["priority", "desktop", "everyone"]);

let cache: { at: number; controls: Promise<LiveControls> } | null = null;

function parseLimit(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseControls(fields: string[] | null): LiveControls {
  const map = new Map<string, string>();
  for (let index = 0; index + 1 < (fields?.length ?? 0); index += 2)
    map.set(fields![index]!, fields![index + 1]!);
  const audience = map.get("videoAudience") as VideoAudience | undefined;
  return {
    videoAudience:
      audience && AUDIENCES.has(audience)
        ? audience
        : DEFAULT_CONTROLS.videoAudience,
    videosPaused: map.get("videosPaused") === "1",
    videoDailyLimit: parseLimit(map.get("videoDailyLimit")),
    videoPersonDailyLimit: parseLimit(map.get("videoPersonDailyLimit")),
    videoNetworkDailyLimit: parseLimit(map.get("videoNetworkDailyLimit")),
  };
}

async function load(): Promise<LiveControls> {
  try {
    return parseControls(
      await upstashCommand<string[] | null>(["HGETALL", KEY]),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "admin.controls.read_failed",
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return DEFAULT_CONTROLS;
  }
}

/** The current controls, at most about a second old. Never throws. */
export function readControls(options?: {
  fresh?: boolean;
}): Promise<LiveControls> {
  const now = Date.now();
  if (!options?.fresh && cache && now - cache.at < CACHE_MS)
    return cache.controls;
  const controls = load();
  cache = { at: now, controls };
  return controls;
}

export async function writeControls(
  patch: Partial<LiveControls>,
): Promise<LiveControls> {
  const set: Array<string | number> = [];
  const unset: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) unset.push(field);
    else if (typeof value === "boolean") set.push(field, value ? "1" : "0");
    else set.push(field, value);
  }
  if (set.length) await upstashCommand(["HSET", KEY, ...set]);
  if (unset.length) await upstashCommand(["HDEL", KEY, ...unset]);
  cache = null;
  return readControls({ fresh: true });
}
