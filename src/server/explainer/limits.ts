import "server-only";

import { randomUUID } from "node:crypto";
import { readControls } from "~/server/admin/controls";
import { isAdminRequest, isOperatorToken } from "~/server/admin/operator";
import { toRateLimitBucket } from "~/server/generate/rate-limit";
import { upstashCommand, upstashEval } from "~/server/storage/upstash";

// Every new video spends real money (Claude plus ElevenLabs), so the public
// path is budgeted per UTC day: overall, per person (one browser, see
// visitor.ts), and per internet connection. The per-person limit is the one
// people normally meet. The per-connection limit is a looser backstop, high
// enough that an office or a university can share one connection, and it
// stops one person from clearing cookies for more. Unlike the diagram limiter
// this fails closed: the daily budget lives in Redis too, so without Redis
// there is no bound on spend.

const DAY_SECONDS = 86_400;

function readLimit(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

interface Limits {
  daily: number;
  person: number;
  network: number;
}

/**
 * New videos the public may create per UTC day: across everyone, per person
 * and per connection. The operator can override each live from /admin.
 */
async function videoLimits(): Promise<Limits> {
  const controls = await readControls();
  return {
    daily: controls.videoDailyLimit ?? readLimit("VIDEO_DAILY_LIMIT", 25),
    person:
      controls.videoPersonDailyLimit ??
      readLimit("VIDEO_PERSON_DAILY_LIMIT", 1),
    network:
      controls.videoNetworkDailyLimit ??
      readLimit("VIDEO_NETWORK_DAILY_LIMIT", 10),
  };
}
/** MP4 renders started per UTC day. Finished renders are cached and free to download. */
const renderLimits = (): Limits => ({
  daily: readLimit("VIDEO_RENDER_DAILY_LIMIT", 300),
  person: readLimit("VIDEO_RENDER_PERSON_DAILY_LIMIT", 8),
  network: readLimit("VIDEO_RENDER_NETWORK_DAILY_LIMIT", 40),
});

/**
 * The operator skips limits and may regenerate: by the token
 * (VIDEO_ADMIN_TOKEN) as a Bearer, or signed in to /admin in this browser.
 */
export function isVideoAdmin(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer "))
    return isOperatorToken(header.slice("Bearer ".length));
  return isAdminRequest(request);
}

/** Limits guard the production budget; locally every caller is trusted. */
export function isTrustedVideoCaller(request: Request): boolean {
  return process.env.NODE_ENV !== "production" || isVideoAdmin(request);
}

const today = () => Math.floor(Date.now() / 1000 / DAY_SECONDS);

// KEYS: everyone, this person, this connection. ARGV: their limits, then TTL.
// Returns 0 when a slot was taken, else which limit is used up (1, 2 or 3).
const RESERVE_SCRIPT = `
for index = 1, 3 do
  if tonumber(redis.call("GET", KEYS[index]) or "0") >= tonumber(ARGV[index]) then
    return index
  end
end
for index = 1, 3 do
  redis.call("INCR", KEYS[index])
  redis.call("EXPIRE", KEYS[index], ARGV[4])
end
return 0
`;

const REFUND_SCRIPT = `
for _, key in ipairs(KEYS) do
  if tonumber(redis.call("GET", key) or "0") > 0 then
    redis.call("DECR", key)
  end
end
return 0
`;

export type LimitReason = "daily" | "person" | "network";

export type Reservation =
  | { ok: true; refund: () => Promise<void> }
  | { ok: false; reason: LimitReason; limit: number };

const REASONS: LimitReason[] = ["daily", "person", "network"];

/** Who is asking: their browser's visitor id and their IP address. */
export interface Requester {
  visitorId: string;
  clientIp: string | null;
}

async function reserve(
  kind: "generate" | "render",
  { visitorId, clientIp }: Requester,
  limits: Limits,
): Promise<Reservation> {
  const day = today();
  // Unattributable callers share one bucket rather than escaping the limit.
  const network = encodeURIComponent(toRateLimitBucket(clientIp ?? "unknown"));
  const keys = [
    `video:v1:${kind}:all:${day}`,
    `video:v1:${kind}:who:${encodeURIComponent(visitorId)}:${day}`,
    `video:v1:${kind}:net:${network}:${day}`,
  ];
  const result = await upstashEval<number>({
    script: RESERVE_SCRIPT,
    keys,
    args: [limits.daily, limits.person, limits.network, DAY_SECONDS * 2],
  });
  const reason = REASONS[result - 1];
  if (reason) return { ok: false, reason, limit: limits[reason] };
  return {
    ok: true,
    // A run that failed on our side should not use up anyone's budget.
    refund: async () => {
      try {
        await upstashEval<number>({ script: REFUND_SCRIPT, keys });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "video.limit.refund_failed",
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    },
  };
}

export async function reserveVideoSlot(requester: Requester) {
  return reserve("generate", requester, await videoLimits());
}

export function reserveRenderSlot(requester: Requester) {
  return reserve("render", requester, renderLimits());
}

/** How many more videos the public may start today. */
export async function videosLeftToday(): Promise<number> {
  const [used, limits] = await Promise.all([
    upstashCommand<string | null>(["GET", `video:v1:generate:all:${today()}`]),
    videoLimits(),
  ]);
  return Math.max(0, limits.daily - (Number(used) || 0));
}

/** Today's video and MP4 budgets and what the public has used, for /admin. */
export async function videoUsageToday() {
  const day = today();
  const [[videos, renders], limits] = await Promise.all([
    upstashCommand<Array<string | null>>([
      "MGET",
      `video:v1:generate:all:${day}`,
      `video:v1:render:all:${day}`,
    ]),
    videoLimits(),
  ]);
  return {
    videos: {
      used: Number(videos) || 0,
      limit: limits.daily,
      personLimit: limits.person,
      networkLimit: limits.network,
    },
    renders: {
      used: Number(renders) || 0,
      limit: renderLimits().daily,
      personLimit: renderLimits().person,
      networkLimit: renderLimits().network,
    },
  };
}

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * One holder at a time across every server instance, or null if someone else
 * holds it. The lock expires on its own if the holder dies.
 */
export async function tryVideoLock(
  name: string,
  ttlMs: number,
): Promise<(() => Promise<void>) | null> {
  const key = `video:v1:lock:${name}`;
  const token = randomUUID();
  const acquired = await upstashCommand<"OK" | null>([
    "SET",
    key,
    token,
    "NX",
    "PX",
    ttlMs,
  ]);
  if (acquired !== "OK") return null;
  return async () => {
    try {
      await upstashEval<number>({
        script: RELEASE_SCRIPT,
        keys: [key],
        args: [token],
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "video.lock.release_failed",
          lock: name,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  };
}

/** "about 7 hours" until the budgets reset at midnight UTC. */
export function timeUntilReset(now = Date.now()): string {
  const hours = Math.ceil(
    (DAY_SECONDS * 1000 - (now % (DAY_SECONDS * 1000))) / 3_600_000,
  );
  return hours <= 1 ? "under an hour" : `about ${hours} hours`;
}

const STILL_FREE =
  "Every video that's already been made is still free to watch.";

export function limitMessage(
  reason: LimitReason,
  limit = 1,
  now = Date.now(),
): string {
  const wait = timeUntilReset(now);
  if (reason === "daily")
    return `Today's free videos have all been made. New ones open up in ${wait}. ${STILL_FREE}`;
  if (reason === "network")
    return `Lots of videos have been made from your internet connection today, so new ones from it are paused. You can make another in ${wait}. ${STILL_FREE}`;
  const used =
    limit === 1
      ? "You've already made your free video for today"
      : `You've already made your ${limit} free videos for today`;
  return `${used}. You can make another in ${wait}. ${STILL_FREE}`;
}

/** The MP4 download limit, worded for whichever budget ran out. */
export function renderLimitMessage(reason: LimitReason): string {
  const wait = timeUntilReset();
  return reason === "daily"
    ? `Today's MP4 downloads have all been used. More open up in ${wait}.`
    : `You've reached today's limit for new MP4 downloads. You can download more in ${wait}.`;
}
