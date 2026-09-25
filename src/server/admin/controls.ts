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
// Starting a new video needs them read: if Redis is down, nothing new starts.

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

// The last controls actually read, for display while Redis is unreachable.
let lastRead: LiveControls | null = null;

async function load(): Promise<LiveControls> {
  const controls = parseControls(
    await upstashCommand<string[] | null>(["HGETALL", KEY]),
  );
  lastRead = controls;
  return controls;
}

function cached(fresh: boolean): Promise<LiveControls> {
  const now = Date.now();
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.controls;
  const controls = load();
  cache = { at: now, controls };
  // A failed read is not cached, so the next request tries Redis again.
  controls.catch((error: unknown) => {
    if (cache?.controls === controls) cache = null;
    console.error(
      JSON.stringify({
        event: "admin.controls.read_failed",
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
  });
  return controls;
}

/**
 * The current controls, at most about a second old, for showing them. Never
 * throws: while Redis is unreachable it answers with the last controls read,
 * or the defaults. Deciding whether to start paid work uses
 * readAdmissionControls instead.
 */
export function readControls(options?: {
  fresh?: boolean;
}): Promise<LiveControls> {
  return cached(Boolean(options?.fresh)).catch(
    () => lastRead ?? DEFAULT_CONTROLS,
  );
}

/**
 * The current controls for deciding whether new paid work may start. Throws
 * when they cannot be read, so a pause or a lowered limit is never skipped
 * because Redis blinked.
 */
export function readAdmissionControls(): Promise<LiveControls> {
  return cached(false);
}

/** The change was saved but the controls could not be read back. */
export class ControlsUnconfirmedError extends Error {}

export async function writeControls(
  patch: Partial<LiveControls>,
): Promise<LiveControls> {
  const set: Array<string | number> = [];
  const unset: string[] = [];
  const written: Partial<LiveControls> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    Object.assign(written, { [field]: value });
    if (value === null) unset.push(field);
    else if (typeof value === "boolean") set.push(field, value ? "1" : "0");
    else set.push(field, value);
  }
  if (set.length) await upstashCommand(["HSET", KEY, ...set]);
  if (unset.length) await upstashCommand(["HDEL", KEY, ...unset]);
  cache = null;
  try {
    return await cached(true);
  } catch (error) {
    // Saved, but not read back: answer with what was written over the last
    // controls read, never with defaults that would misreport the switches.
    if (!lastRead)
      throw new ControlsUnconfirmedError(
        error instanceof Error ? error.message : "unknown",
      );
    return { ...lastRead, ...written };
  }
}
