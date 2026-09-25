import "server-only";

import { randomUUID } from "node:crypto";
import { readControls } from "~/server/admin/controls";
import { isAdminRequest, isOperatorToken } from "~/server/admin/operator";
import { toRateLimitBucket } from "~/server/generate/rate-limit";
import { upstashCommand, upstashEval } from "~/server/storage/upstash";

// Every new video spends real money (Claude plus ElevenLabs), so the public
// path is budgeted per UTC day, both overall and per network. Unlike the
// diagram limiter this fails closed: the daily budget lives in Redis too, so
// without Redis there is no bound on spend.

const DAY_SECONDS = 86_400;

function readLimit(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * New videos the public may create per UTC day, across everyone and per
 * network. The operator can override both live from /admin.
 */
async function videoLimits(): Promise<{ daily: number; network: number }> {
  const controls = await readControls();
  return {
    daily: controls.videoDailyLimit ?? readLimit("VIDEO_DAILY_LIMIT", 25),
    network:
      controls.videoNetworkDailyLimit ?? readLimit("VIDEO_IP_DAILY_LIMIT", 1),
  };
}
/** MP4 renders started per UTC day. Finished renders are cached and free to download. */
const renderDailyLimit = () => readLimit("VIDEO_RENDER_DAILY_LIMIT", 300);
const renderNetworkDailyLimit = () =>
  readLimit("VIDEO_RENDER_IP_DAILY_LIMIT", 8);

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

const RESERVE_SCRIPT = `
local used = tonumber(redis.call("GET", KEYS[1]) or "0")
if used >= tonumber(ARGV[1]) then return 1 end
local mine = tonumber(redis.call("GET", KEYS[2]) or "0")
if mine >= tonumber(ARGV[2]) then return 2 end
redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[3])
redis.call("INCR", KEYS[2])
redis.call("EXPIRE", KEYS[2], ARGV[3])
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

export type Reservation =
  | { ok: true; refund: () => Promise<void> }
  | { ok: false; reason: "daily" | "network" };

async function reserve(
  kind: "generate" | "render",
  clientIp: string | null,
  dailyLimit: number,
  networkLimit: number,
): Promise<Reservation> {
  const day = today();
  // Unattributable callers share one bucket rather than escaping the limit.
  const network = encodeURIComponent(toRateLimitBucket(clientIp ?? "unknown"));
  const keys = [
    `video:v1:${kind}:all:${day}`,
    `video:v1:${kind}:net:${network}:${day}`,
  ];
  const result = await upstashEval<number>({
    script: RESERVE_SCRIPT,
    keys,
    args: [dailyLimit, networkLimit, DAY_SECONDS * 2],
  });
  if (result === 1) return { ok: false, reason: "daily" };
  if (result === 2) return { ok: false, reason: "network" };
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

export async function reserveVideoSlot(clientIp: string | null) {
  const limits = await videoLimits();
  return reserve("generate", clientIp, limits.daily, limits.network);
}

export function reserveRenderSlot(clientIp: string | null) {
  return reserve(
    "render",
    clientIp,
    renderDailyLimit(),
    renderNetworkDailyLimit(),
  );
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
      networkLimit: limits.network,
    },
    renders: {
      used: Number(renders) || 0,
      limit: renderDailyLimit(),
      networkLimit: renderNetworkDailyLimit(),
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

export function limitMessage(reason: "daily" | "network"): string {
  return reason === "daily"
    ? "Today's free videos have all been made. New ones open up tomorrow (UTC); every video already made stays free to watch."
    : "This network has made its videos for today. Try again tomorrow; every video already made stays free to watch.";
}
