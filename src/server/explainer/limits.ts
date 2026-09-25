import "server-only";

import { randomUUID } from "node:crypto";
import { readAdmissionControls, readControls } from "~/server/admin/controls";
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
//
// The operator can start today's counts over from /admin. Rather than delete
// counters that runs in flight still hold, a reset moves every count to a new
// epoch (part of each counter's name): new runs count from zero, and a refund
// from before the reset lands in the old, unread counters.

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
 * and per connection. The operator can override each live from /admin. For
 * admission the overrides must be read (it throws without Redis); for
 * display the last known ones do.
 */
async function videoLimits(admission: boolean): Promise<Limits> {
  const controls = await (admission ? readAdmissionControls() : readControls());
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

type Kind = "generate" | "render";

const epochKey = (kind: Kind) => `video:v1:${kind}:epoch`;

/** Today's counters' shared suffix. Epoch 0 keeps the names from before epochs. */
const period = (day: number, epoch: string) =>
  epoch === "0" ? `${day}` : `${day}:e${epoch}`;

async function currentEpochs(kinds: Kind[]): Promise<string[]> {
  const epochs = await upstashCommand<Array<string | null>>([
    "MGET",
    ...kinds.map(epochKey),
  ]);
  return kinds.map((_, index) => epochs[index] ?? "0");
}

// KEYS: everyone, this person, this connection, the epoch. ARGV: their
// limits, the TTL, then the epoch the keys were named for. Returns 0 when a
// slot was taken, -1 when a reset moved the epoch meanwhile, else which limit
// is used up (1, 2 or 3).
const RESERVE_SCRIPT = `
if (redis.call("GET", KEYS[4]) or "0") ~= ARGV[5] then
  return -1
end
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
  kind: Kind,
  { visitorId, clientIp }: Requester,
  limits: Limits,
): Promise<Reservation> {
  const day = today();
  // Unattributable callers share one bucket rather than escaping the limit.
  const network = encodeURIComponent(toRateLimitBucket(clientIp ?? "unknown"));
  let keys: string[] = [];
  let result = -1;
  // A reset between reading the epoch and counting is rare; count again.
  for (let attempt = 0; attempt < 3 && result === -1; attempt++) {
    const [epoch] = await currentEpochs([kind]);
    const suffix = period(day, epoch!);
    keys = [
      `video:v1:${kind}:all:${suffix}`,
      `video:v1:${kind}:who:${encodeURIComponent(visitorId)}:${suffix}`,
      `video:v1:${kind}:net:${network}:${suffix}`,
    ];
    result = await upstashEval<number>({
      script: RESERVE_SCRIPT,
      keys: [...keys, epochKey(kind)],
      args: [
        limits.daily,
        limits.person,
        limits.network,
        DAY_SECONDS * 2,
        epoch!,
      ],
    });
  }
  if (result === -1) throw new Error("The video budget kept changing.");
  const reason = REASONS[result - 1];
  if (reason) return { ok: false, reason, limit: limits[reason] };
  return {
    ok: true,
    // A run that failed on our side should not use up anyone's budget. The
    // keys carry the epoch, so after a reset this cannot free a new slot.
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
  return reserve("generate", requester, await videoLimits(true));
}

export function reserveRenderSlot(requester: Requester) {
  return reserve("render", requester, renderLimits());
}

/** How many of each kind the public has started today, in the current epochs. */
async function usedToday(kinds: Kind[]): Promise<number[]> {
  const day = today();
  const epochs = await currentEpochs(kinds);
  const used = await upstashCommand<Array<string | null>>([
    "MGET",
    ...kinds.map(
      (kind, index) => `video:v1:${kind}:all:${period(day, epochs[index]!)}`,
    ),
  ]);
  return kinds.map((_, index) => Number(used[index]) || 0);
}

/** How many more videos the public may start today. Throws without Redis. */
export async function videosLeftToday(): Promise<number> {
  const [[used], limits] = await Promise.all([
    usedToday(["generate"]),
    videoLimits(true),
  ]);
  return Math.max(0, limits.daily - used!);
}

/** Today's video and MP4 budgets and what the public has used, for /admin. */
export async function videoUsageToday() {
  const [[videos, renders], limits] = await Promise.all([
    usedToday(["generate", "render"]),
    videoLimits(false),
  ]);
  return {
    videos: {
      used: videos!,
      limit: limits.daily,
      personLimit: limits.person,
      networkLimit: limits.network,
    },
    renders: {
      used: renders!,
      limit: renderLimits().daily,
      personLimit: renderLimits().person,
      networkLimit: renderLimits().network,
    },
  };
}

/**
 * Start today's count over for new videos or MP4s: the overall total and
 * every person's and network's own count, all at once by moving to a new
 * epoch. Returns how many the public had started today before the reset.
 * The operator does this from /admin.
 */
export async function resetUsageToday(kind: Kind): Promise<number> {
  const [used] = await usedToday([kind]);
  await upstashCommand<number>(["INCR", epochKey(kind)]);
  return used!;
}

// Paid runs at once across every instance. ElevenLabs Starter voices four
// requests at a time; one is left for the operator's own runs.
const MAX_PAID_RUNS = 3;
const PAID_RUNS_KEY = "video:v1:generate:running";

// KEYS: the running set. ARGV: now, the cap, whether to skip the cap, this
// run's expiry, its token, and the set's TTL. Returns 1 when admitted.
const PAID_RUN_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if ARGV[3] ~= "1" and redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call("ZADD", KEYS[1], ARGV[4], ARGV[5])
redis.call("PEXPIRE", KEYS[1], ARGV[6])
return 1
`;

/**
 * A place among the videos being paid for right now, or null when the cap is
 * reached. A refunded failure costs its visitor nothing, but the Claude and
 * voice calls were still paid; the cap bounds how much of that can happen at
 * once. The operator's runs count toward it but are never refused. A run
 * that dies without releasing its place loses it after ttlMs.
 */
export async function tryPaidVideoRun(params: {
  operator: boolean;
  ttlMs: number;
}): Promise<(() => Promise<void>) | null> {
  const token = randomUUID();
  const now = Date.now();
  const admitted = await upstashEval<number>({
    script: PAID_RUN_SCRIPT,
    keys: [PAID_RUNS_KEY],
    args: [
      now,
      MAX_PAID_RUNS,
      params.operator ? "1" : "0",
      now + params.ttlMs,
      token,
      params.ttlMs,
    ],
  });
  if (admitted !== 1) return null;
  return async () => {
    try {
      await upstashCommand<number>(["ZREM", PAID_RUNS_KEY, token]);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "video.paid_run.release_failed",
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  };
}

/**
 * Whether this is the first time in ten minutes that this connection was held
 * back from making a video of this repository, so the /admin feed shows
 * demand without a reload loop flooding it. False when Redis cannot say.
 */
export async function firstGateNotice(params: {
  clientIp: string | null;
  repository: string;
  step: string;
}): Promise<boolean> {
  const network = encodeURIComponent(
    toRateLimitBucket(params.clientIp ?? "unknown"),
  );
  try {
    const set = await upstashCommand<"OK" | null>([
      "SET",
      `video:v1:gated:${params.step}:${network}:${params.repository.toLowerCase()}`,
      "1",
      "NX",
      "EX",
      600,
    ]);
    return set === "OK";
  } catch {
    return false;
  }
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
function timeUntilReset(now = Date.now()): string {
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
