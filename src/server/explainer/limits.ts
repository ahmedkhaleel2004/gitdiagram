import "server-only";

import { randomUUID } from "node:crypto";
import { networkOf } from "~/lib/network";
import { readAdmissionControls, readControls } from "~/server/admin/controls";
import { verifyAdminRequest } from "~/server/admin/operator";
import { verifyOperatorBearer } from "~/server/admin/sign-in-guard";
import { readIntEnv } from "~/server/env";
import { errorText, logEvent } from "~/server/log";
import { tryDistributedLock } from "~/server/storage/distributed-lock";
import { upstashCommand, upstashEval } from "~/server/storage/upstash";

// Every new video spends real money (Claude or GPT, plus the voice), so the
// public path is budgeted per UTC day: overall, per person (one browser, see
// visitor.ts), and per internet connection. The per-person limit is the one
// people normally meet; people in the priority places get a higher one, and
// their first video of the day is made with the premium model (see
// takePremiumVideo). The per-connection limit is a looser backstop, high
// enough that an office or a university can share one connection, and it
// stops one person from clearing cookies for more. Unlike the diagram limiter
// this fails closed: the daily budget lives in Redis too, so without Redis
// there is no bound on spend.
//
// Premium-model videos are counted per person and per connection, so a
// browser that sends a new visitor id with every request still gets only a
// few. Starting a video at all is also limited per connection per hour, and
// that count is never refunded: a run that fails before any model call gives
// back its daily place, but it has still read the repository with the site's
// credentials.
//
// The operator can start today's counts over from /admin. Rather than delete
// counters that runs in flight still hold, a reset moves every count to a new
// epoch (part of each counter's name): new runs count from zero, and a refund
// from before the reset lands in the old, unread counters.

const DAY_SECONDS = 86_400;

/**
 * The connection a request came from, as part of a counter's name. One IPv6
 * subscriber holds a whole /64, so that is one connection. Unattributable
 * callers share one bucket rather than escaping the limit.
 */
const networkKey = (clientIp: string | null) =>
  encodeURIComponent(networkOf(clientIp ?? "unknown"));

interface Limits {
  daily: number;
  person: number;
  network: number;
}

/**
 * New videos the public may create per UTC day: across everyone, per person
 * (higher for someone in a priority place) and per connection. The operator
 * can override each live from /admin. For admission the overrides must be
 * read (it throws without Redis); for display the last known ones do.
 */
async function videoLimits(
  admission: boolean,
): Promise<Limits & { priorityPerson: number }> {
  const controls = await (admission ? readAdmissionControls() : readControls());
  return {
    daily: controls.videoDailyLimit ?? readIntEnv("VIDEO_DAILY_LIMIT", 25),
    person:
      controls.videoPersonDailyLimit ??
      readIntEnv("VIDEO_PERSON_DAILY_LIMIT", 1),
    priorityPerson:
      controls.videoPriorityPersonDailyLimit ??
      readIntEnv("VIDEO_PRIORITY_PERSON_DAILY_LIMIT", 3),
    network:
      controls.videoNetworkDailyLimit ??
      readIntEnv("VIDEO_NETWORK_DAILY_LIMIT", 10),
  };
}

/** Premium-model videos per priority person per UTC day. */
const premiumPerPerson = () =>
  readIntEnv("VIDEO_PREMIUM_PERSON_DAILY_LIMIT", 1);
/** Premium-model videos per connection per UTC day (twice a person's by default). */
const premiumPerNetwork = () =>
  readIntEnv("VIDEO_PREMIUM_NETWORK_DAILY_LIMIT", premiumPerPerson() * 2);
/** MP4 renders started per UTC day. Finished renders are cached and free to download. */
const renderLimits = (): Limits => ({
  daily: readIntEnv("VIDEO_RENDER_DAILY_LIMIT", 300),
  person: readIntEnv("VIDEO_RENDER_PERSON_DAILY_LIMIT", 8),
  network: readIntEnv("VIDEO_RENDER_NETWORK_DAILY_LIMIT", 40),
});

/**
 * The operator skips limits and may regenerate: by the token
 * (VIDEO_ADMIN_TOKEN) as a Bearer, or signed in to /admin in this browser.
 * Wrong Bearer tokens count as failed sign-ins (sign-in-guard.ts).
 */
export async function isVideoAdmin(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer "))
    return verifyOperatorBearer(request, header.slice("Bearer ".length));
  return verifyAdminRequest(request);
}

/** Limits guard the production budget; locally every caller is trusted. */
export async function isTrustedVideoCaller(request: Request): Promise<boolean> {
  return process.env.NODE_ENV !== "production" || (await isVideoAdmin(request));
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

/** Today's counters for everyone, this person and this connection. */
function budgetKeys(
  kind: Kind,
  { visitorId, clientIp }: Requester,
  suffix: string,
): string[] {
  return [
    `video:v1:${kind}:all:${suffix}`,
    `video:v1:${kind}:who:${encodeURIComponent(visitorId)}:${suffix}`,
    `video:v1:${kind}:net:${networkKey(clientIp)}:${suffix}`,
  ];
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
  requester: Requester,
  limits: Limits,
): Promise<Reservation> {
  const day = today();
  let keys: string[] = [];
  let result = -1;
  // A reset between reading the epoch and counting is rare; count again.
  for (let attempt = 0; attempt < 3 && result === -1; attempt++) {
    const [epoch] = await currentEpochs([kind]);
    keys = budgetKeys(kind, requester, period(day, epoch!));
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
        logEvent("error", "video.limit.refund_failed", {
          error: errorText(error),
        });
      }
    },
  };
}

/** A place in today's video budget; someone in a priority place gets more. */
export async function reserveVideoSlot(
  requester: Requester,
  options: { priority: boolean },
) {
  const limits = await videoLimits(true);
  return reserve("generate", requester, {
    ...limits,
    person: options.priority ? limits.priorityPerson : limits.person,
  });
}

// KEYS: this person's and this connection's premium counts. ARGV: their
// limits, then the TTL. Returns 1 when one was taken (from both).
const TAKE_PREMIUM_SCRIPT = `
for index = 1, #KEYS do
  if tonumber(redis.call("GET", KEYS[index]) or "0") >= tonumber(ARGV[index]) then
    return 0
  end
end
for index = 1, #KEYS do
  redis.call("INCR", KEYS[index])
  redis.call("EXPIRE", KEYS[index], ARGV[#KEYS + 1])
end
return 1
`;

/**
 * One of this person's premium-model videos for today, with a way to give it
 * back, or null when they, or their connection, have used theirs. It counts
 * in the same epoch as the video budget, so a reset in /admin starts it over
 * too.
 */
export async function takePremiumVideo({
  visitorId,
  clientIp,
}: Requester): Promise<{ refund: () => Promise<void> } | null> {
  const [epoch] = await currentEpochs(["generate"]);
  const suffix = period(today(), epoch!);
  const keys = [
    `video:v1:premium:who:${encodeURIComponent(visitorId)}:${suffix}`,
    `video:v1:premium:net:${networkKey(clientIp)}:${suffix}`,
  ];
  const taken = await upstashEval<number>({
    script: TAKE_PREMIUM_SCRIPT,
    keys,
    args: [premiumPerPerson(), premiumPerNetwork(), DAY_SECONDS * 2],
  });
  if (taken !== 1) return null;
  return {
    refund: async () => {
      try {
        await upstashEval<number>({ script: REFUND_SCRIPT, keys });
      } catch (error) {
        logEvent("error", "video.premium.refund_failed", {
          error: errorText(error),
        });
      }
    },
  };
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

/**
 * Which of today's budgets would turn this person away (everyone's, their
 * own or their connection's), or null while all have room. Read-only: the
 * generate route still reserves atomically. Throws without Redis.
 */
export async function videoLimitReached(
  requester: Requester,
  options: { priority: boolean },
): Promise<{ reason: LimitReason; limit: number } | null> {
  const day = today();
  const [[epoch], limits] = await Promise.all([
    currentEpochs(["generate"]),
    videoLimits(true),
  ]);
  const used = await upstashCommand<Array<string | null>>([
    "MGET",
    ...budgetKeys("generate", requester, period(day, epoch!)),
  ]);
  const allowed: Limits = {
    ...limits,
    person: options.priority ? limits.priorityPerson : limits.person,
  };
  for (const [index, reason] of REASONS.entries())
    if ((Number(used[index]) || 0) >= allowed[reason])
      return { reason, limit: allowed[reason] };
  return null;
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
      priorityPersonLimit: limits.priorityPerson,
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
  const day = today();
  const epoch = await upstashCommand<number>(["INCR", epochKey(kind)]);
  // Read the old epoch's total after moving on, so no run counts after it.
  const used = await upstashCommand<string | null>([
    "GET",
    `video:v1:${kind}:all:${period(day, String(Number(epoch) - 1))}`,
  ]);
  return Number(used) || 0;
}

// Paid runs at once across every instance (VIDEO_MAX_PAID_RUNS, default 10).
// Each run makes one short voice call (voice.ts), which OpenRouter does not
// rate-limit, so the voice does not cap this.
const maxPaidRuns = () => readIntEnv("VIDEO_MAX_PAID_RUNS", 10);
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
 * reached. Taken just before a run's first model call, so runs still reading
 * the repository (or failing to) hold none. The operator's runs count toward
 * it but are never refused. A run that dies without releasing its place
 * loses it after ttlMs.
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
      maxPaidRuns(),
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
      logEvent("error", "video.paid_run.release_failed", {
        error: errorText(error),
      });
    }
  };
}

// KEYS: one connection's counter for the current window. ARGV: the limit,
// then the seconds left in the window. Returns 1 while under the limit. The
// count is never given back.
const WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 or redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[2])
end
if count > tonumber(ARGV[1]) then
  return 0
end
return 1
`;

/**
 * Count one more use of `name` by this connection in the current fixed
 * window (aligned to the epoch, so its start names the counter). Throws when
 * Redis fails.
 */
async function countInWindow(
  name: string,
  clientIp: string | null,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % windowSeconds);
  const left = start + windowSeconds - now;
  const ok = await upstashEval<number>({
    script: WINDOW_SCRIPT,
    keys: [`video:v1:${name}:${networkKey(clientIp)}:${start}`],
    args: [limit, left],
  });
  return { ok: ok === 1, retryAfterSeconds: left };
}

/**
 * One more new video started from this connection this hour
 * (VIDEO_NETWORK_ATTEMPT_LIMIT, default 10), or how long until it may start
 * another. Every run reads the repository from GitHub with the site's
 * credentials before any model call, and a run that fails there gets its
 * daily place back, so this count is what bounds those reads: it is never
 * refunded. Throws when Redis fails.
 */
export function takeVideoAttempt(clientIp: string | null) {
  return countInWindow(
    "attempts",
    clientIp,
    readIntEnv("VIDEO_NETWORK_ATTEMPT_LIMIT", 10),
    readIntEnv("VIDEO_NETWORK_ATTEMPT_WINDOW_SECONDS", 3600, { min: 1 }),
  );
}

/** GitHub lookups for the /admin feed per connection every ten minutes. */
const GATE_LOOKUPS = { limit: 5, windowSeconds: 600 };

/**
 * Whether the /admin feed may look a held-back visitor's repository up on
 * GitHub (to name it only if it is public): a few lookups per connection
 * every ten minutes. The feed is only telemetry, so over the limit, or when
 * Redis cannot say, the answer is no.
 */
export async function takeGateLookup(
  clientIp: string | null,
): Promise<boolean> {
  try {
    const { ok } = await countInWindow(
      "gate-lookups",
      clientIp,
      GATE_LOOKUPS.limit,
      GATE_LOOKUPS.windowSeconds,
    );
    return ok;
  } catch {
    return false;
  }
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
  const network = networkKey(params.clientIp);
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

/**
 * One holder at a time across every server instance, or null if someone else
 * holds it. The lock expires on its own if the holder dies.
 */
export function tryVideoLock(
  name: string,
  ttlMs: number,
): Promise<(() => Promise<void>) | null> {
  return tryDistributedLock({
    key: `video:v1:lock:${name}`,
    ttlMs,
    releaseFailureEvent: "video.lock.release_failed",
  });
}

/** The lock a repository's video generation holds while it runs. */
export const generationLockName = (username: string, repo: string) =>
  `generate:${username}/${repo}`.toLowerCase();

/** Whether someone holds the lock right now. False when Redis cannot say. */
export async function isVideoLockHeld(name: string): Promise<boolean> {
  try {
    return (
      (await upstashCommand<number>(["EXISTS", `video:v1:lock:${name}`])) === 1
    );
  } catch {
    return false;
  }
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

/**
 * Why new videos are paused: the operator paused them from /admin
 * ("paused", until they resume), or the narrator's balance ran out ("voice",
 * which lifts on its own within minutes).
 */
export function pausedMessage(reason: "paused" | "voice"): string {
  return reason === "voice"
    ? `New videos are paused for a few minutes. Try again soon. ${STILL_FREE}`
    : `New videos are paused for now. Try again later. ${STILL_FREE}`;
}

/** Too many new videos started from one connection within the hour. */
export function attemptLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Lots of videos have been started from your internet connection lately. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}. ${STILL_FREE}`;
}

/** The MP4 download limit, worded for whichever budget ran out. */
export function renderLimitMessage(reason: LimitReason): string {
  const wait = timeUntilReset();
  return reason === "daily"
    ? `Today's MP4 downloads have all been used. More open up in ${wait}.`
    : `You've reached today's limit for new MP4 downloads. You can download more in ${wait}.`;
}
