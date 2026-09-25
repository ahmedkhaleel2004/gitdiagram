import "server-only";

import { networkOf } from "~/lib/network";
import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import { isOperatorConfigured, isOperatorToken } from "~/server/admin/operator";
import { getClientIp } from "~/server/http/client-ip";
import { errorText, logEvent } from "~/server/log";
import { upstashEval } from "~/server/storage/upstash";

// Wrong operator tokens, per network, whether typed into /admin or sent as a
// Bearer to the video API: after a handful, that network waits before it may
// try again, and the dashboard's feed shows one "Failed sign-in" per network
// every ten minutes rather than one per guess. The token is far too long to
// guess; this keeps a script from flooding the feed and the logs. When Redis
// is down the check lets the request through (the operator must still be
// able to sign in), and every failure is announced.

const MAX_FAILURES = 10;
const WINDOW_SECONDS = 15 * 60;
const ANNOUNCE_EVERY_SECONDS = 10 * 60;

const keys = (request: Request) => {
  const ip = getClientIp(request);
  if (!ip) return null;
  const bucket = encodeURIComponent(networkOf(ip));
  return {
    failures: `admin:v1:sign-in-failures:${bucket}`,
    announced: `admin:v1:sign-in-announced:${bucket}`,
  };
};

// One script, so a burst of wrong tokens sent at once cannot all pass the
// check before any of them is counted: a wrong token is counted first, then
// judged on the count it got.
// KEYS: failures, announced. ARGV: max failures, failure window, announce
// interval, "1" when the token was wrong. Returns {blocked, retry after
// seconds, announce}.
const SIGN_IN_SCRIPT = `
local count
if ARGV[4] == "1" then
  count = redis.call("INCR", KEYS[1])
  if count == 1 or redis.call("TTL", KEYS[1]) < 0 then
    redis.call("EXPIRE", KEYS[1], ARGV[2])
  end
else
  count = tonumber(redis.call("GET", KEYS[1]) or "0")
end
local max = tonumber(ARGV[1])
if (ARGV[4] == "1" and count > max) or (ARGV[4] ~= "1" and count >= max) then
  return {1, redis.call("TTL", KEYS[1]), 0}
end
if ARGV[4] == "1" and redis.call("SET", KEYS[2], "1", "NX", "EX", ARGV[3]) then
  return {0, 0, 1}
end
return {0, 0, 0}
`;

export interface SignInCheck {
  /** This network used up its failed tries; refuse, whatever the token. */
  blocked: boolean;
  retryAfterSeconds: number;
  /** A wrong token to show on the dashboard: the first from here in a while. */
  announce: boolean;
}

/**
 * Counts a sign-in attempt whose token was already checked (`correct`), and
 * says whether to refuse it. A wrong token is counted; a right one only
 * checks that the network is not locked out.
 */
export async function checkSignIn(
  request: Request,
  correct: boolean,
): Promise<SignInCheck> {
  const key = keys(request);
  if (!key) return { blocked: false, retryAfterSeconds: 0, announce: !correct };
  try {
    const [blocked, ttl, announce] = await upstashEval<
      [number, number, number]
    >({
      script: SIGN_IN_SCRIPT,
      keys: [key.failures, key.announced],
      args: [
        MAX_FAILURES,
        WINDOW_SECONDS,
        ANNOUNCE_EVERY_SECONDS,
        correct ? "0" : "1",
      ],
    });
    return blocked === 1
      ? {
          blocked: true,
          retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS,
          announce: false,
        }
      : { blocked: false, retryAfterSeconds: 0, announce: announce === 1 };
  } catch (error) {
    logEvent("warn", "admin.sign_in_guard.unavailable", {
      error: errorText(error),
    });
    return { blocked: false, retryAfterSeconds: 0, announce: !correct };
  }
}

// One answer per request: a route may ask more than once (whether the caller
// is trusted, then whether it may replace), and a wrong token counts once.
const bearerChecks = new WeakMap<Request, Promise<boolean>>();

/**
 * Whether the request's Bearer is the operator token (VIDEO_ADMIN_TOKEN), the
 * way scripts call the video API. Wrong tokens count against the network's
 * failed sign-ins and show on the dashboard, just like /admin's form.
 */
export function verifyOperatorBearer(
  request: Request,
  presented: string,
): Promise<boolean> {
  let check = bearerChecks.get(request);
  if (!check) {
    check = (async () => {
      if (!isOperatorConfigured()) return false;
      const correct = isOperatorToken(presented);
      const { blocked, announce } = await checkSignIn(request, correct);
      if (announce)
        void emitLiveEvent({
          kind: "admin.sign_in_failed",
          via: "bearer",
          ...requestOrigin(request),
        });
      return correct && !blocked;
    })();
    bearerChecks.set(request, check);
  }
  return check;
}
