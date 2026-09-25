import "server-only";

import type {
  LiveControls,
  PriorityPlaces,
  VideoAudience,
} from "~/features/admin/types";
import { errorText, logEvent } from "~/server/log";
import { upstashCommand, upstashEval } from "~/server/storage/upstash";

// Switches the operator flips from /admin while the site is running. They live
// in Redis so every server instance sees a change within a second, with no
// redeploy. Anything unset falls back to the deployment's environment:
// - videoAudience: who may make new videos: the priority places on any
//   device ("priority"), those plus any desktop, or everyone.
// - priorityPlaces: which places are priority: a few cities and states, or
//   all of the US, Canada and the UK. People there may make more videos a
//   day, the first of them with the premium model.
// - videosPaused: stop every new video, whoever asks.
// - videoDailyLimit, videoPersonDailyLimit, videoPriorityPersonDailyLimit,
//   videoNetworkDailyLimit: override VIDEO_DAILY_LIMIT,
//   VIDEO_PERSON_DAILY_LIMIT, VIDEO_PRIORITY_PERSON_DAILY_LIMIT and
//   VIDEO_NETWORK_DAILY_LIMIT.
// Starting a new video needs them read: if Redis is down, nothing new starts.

export const DEFAULT_CONTROLS: LiveControls = {
  videoAudience: "priority",
  priorityPlaces: "cities",
  videosPaused: false,
  videoDailyLimit: null,
  videoPersonDailyLimit: null,
  videoPriorityPersonDailyLimit: null,
  videoNetworkDailyLimit: null,
};

const KEY = "admin:v1:controls";
// Long enough that a burst of requests shares one read, short enough that a
// flipped switch reaches every instance within about a second.
const CACHE_MS = 1_000;
const AUDIENCES = new Set<VideoAudience>(["priority", "desktop", "everyone"]);
const PLACES = new Set<PriorityPlaces>(["cities", "countries"]);

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
  const places = map.get("priorityPlaces") as PriorityPlaces | undefined;
  return {
    videoAudience:
      audience && AUDIENCES.has(audience)
        ? audience
        : DEFAULT_CONTROLS.videoAudience,
    priorityPlaces:
      places && PLACES.has(places) ? places : DEFAULT_CONTROLS.priorityPlaces,
    videosPaused: map.get("videosPaused") === "1",
    videoDailyLimit: parseLimit(map.get("videoDailyLimit")),
    videoPersonDailyLimit: parseLimit(map.get("videoPersonDailyLimit")),
    videoPriorityPersonDailyLimit: parseLimit(
      map.get("videoPriorityPersonDailyLimit"),
    ),
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
    logEvent("error", "admin.controls.read_failed", {
      error: errorText(error),
    });
  });
  return controls;
}

/**
 * The current controls for showing them, and whether Redis could not be read
 * just now (`unreadable`), in which case they are the last controls this
 * instance read, or the defaults on an instance that never read any.
 */
export async function readControlsForDisplay(options?: {
  fresh?: boolean;
}): Promise<{ controls: LiveControls; unreadable: boolean }> {
  try {
    return {
      controls: await cached(Boolean(options?.fresh)),
      unreadable: false,
    };
  } catch {
    return { controls: lastRead ?? DEFAULT_CONTROLS, unreadable: true };
  }
}

/**
 * The current controls, at most about a second old, for showing them. Never
 * throws: while Redis is unreachable it answers with the last controls read,
 * or the defaults. Deciding whether to start paid work uses
 * readAdmissionControls instead.
 */
export async function readControls(options?: {
  fresh?: boolean;
}): Promise<LiveControls> {
  return (await readControlsForDisplay(options)).controls;
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

// Sets and clears fields in one step, so a change is saved whole or not at
// all. KEYS: the controls hash. ARGV: how many of the rest are field/value
// pairs to set (counted in items), those pairs, then the fields to clear.
export const WRITE_CONTROLS_SCRIPT = `
local set = tonumber(ARGV[1])
if set > 0 then
  redis.call("HSET", KEYS[1], unpack(ARGV, 2, 1 + set))
end
if #ARGV > 1 + set then
  redis.call("HDEL", KEYS[1], unpack(ARGV, 2 + set))
end
return 1
`;

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
  if (set.length || unset.length)
    await upstashEval<number>({
      script: WRITE_CONTROLS_SCRIPT,
      keys: [KEY],
      args: [set.length, ...set, ...unset],
    });
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
