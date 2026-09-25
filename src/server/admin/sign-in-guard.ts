import "server-only";

import { toRateLimitBucket } from "~/server/generate/rate-limit";
import { getClientIp } from "~/server/http/client-ip";
import { upstashEval } from "~/server/storage/upstash";

// Failed /admin sign-ins, per network: after a handful, that network waits
// before it may try again, and the dashboard's feed shows one "Failed
// sign-in" per network every ten minutes rather than one per guess. The token
// is far too long to guess; this keeps a script from flooding the feed and
// the logs. When Redis is down both checks let the request through (the
// operator must still be able to sign in), and every failure is announced.

const MAX_FAILURES = 10;
const WINDOW_SECONDS = 15 * 60;
const ANNOUNCE_EVERY_SECONDS = 10 * 60;

const keys = (request: Request) => {
  const ip = getClientIp(request);
  if (!ip) return null;
  const bucket = encodeURIComponent(toRateLimitBucket(ip));
  return {
    failures: `admin:v1:sign-in-failures:${bucket}`,
    announced: `admin:v1:sign-in-announced:${bucket}`,
  };
};

const READ_SCRIPT = `
local count = tonumber(redis.call("GET", KEYS[1]) or "0")
return {count, redis.call("TTL", KEYS[1])}
`;

// KEYS: failures, announced. ARGV: failure window, announce interval.
const RECORD_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 or redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
if redis.call("SET", KEYS[2], "1", "NX", "EX", ARGV[2]) then
  return 1
end
return 0
`;

function unavailable(error: unknown): void {
  console.warn(
    JSON.stringify({
      event: "admin.sign_in_guard.unavailable",
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    }),
  );
}

/** Whether this network used up its failed sign-ins, and for how long. */
export async function signInBlocked(
  request: Request,
): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const key = keys(request);
  if (!key) return { blocked: false, retryAfterSeconds: 0 };
  try {
    const [count, ttl] = await upstashEval<[number, number]>({
      script: READ_SCRIPT,
      keys: [key.failures],
    });
    return count >= MAX_FAILURES
      ? { blocked: true, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS }
      : { blocked: false, retryAfterSeconds: 0 };
  } catch (error) {
    unavailable(error);
    return { blocked: false, retryAfterSeconds: 0 };
  }
}

/**
 * Counts a failed sign-in. Returns whether to announce it on the dashboard:
 * the first from this network in ten minutes.
 */
export async function recordFailedSignIn(
  request: Request,
): Promise<{ announce: boolean }> {
  const key = keys(request);
  if (!key) return { announce: true };
  try {
    const fresh = await upstashEval<number>({
      script: RECORD_SCRIPT,
      keys: [key.failures, key.announced],
      args: [WINDOW_SECONDS, ANNOUNCE_EVERY_SECONDS],
    });
    return { announce: fresh === 1 };
  } catch (error) {
    unavailable(error);
    return { announce: true };
  }
}
