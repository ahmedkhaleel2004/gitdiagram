import { upstashEval } from "~/server/storage/upstash";

const DEFAULT_MAX_GENERATIONS = 8;
const DEFAULT_WINDOW_SECONDS = 60 * 60;

export const GENERATION_RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local count = redis.call("INCR", key)
if count == 1 then
  redis.call("EXPIRE", key, window)
end

local ttl = redis.call("TTL", key)
if ttl < 0 then
  -- A key without a TTL would throttle the caller forever, so re-arm it.
  redis.call("EXPIRE", key, window)
  ttl = window
end

if count > limit then
  return {0, ttl}
end

return {1, ttl}
`;

function readEnvInt(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getGenerationRateLimitMax(): number {
  return readEnvInt("GENERATION_RATE_LIMIT_MAX", DEFAULT_MAX_GENERATIONS);
}

export function getGenerationRateLimitWindowSeconds(): number {
  return readEnvInt(
    "GENERATION_RATE_LIMIT_WINDOW_SECONDS",
    DEFAULT_WINDOW_SECONDS,
  );
}

export const GENERATION_RATE_LIMIT_REFUND_SCRIPT = `
local key = KEYS[1]
local count = tonumber(redis.call("GET", key))
if not count or count <= 0 then
  return 0
end

-- DECR leaves the TTL alone, so the window still closes on its original clock.
redis.call("DECR", key)
return 1
`;

/**
 * Collapses an IPv6 address to its /64 prefix.
 *
 * A residential IPv6 allocation is a whole /64 or larger, so keying the limiter
 * on the full /128 lets one client occupy an effectively unlimited number of
 * buckets. IPv4 (and IPv4-mapped) addresses are returned unchanged.
 */
export function toRateLimitBucket(clientIp: string): string {
  if (!clientIp.includes(":")) {
    return clientIp;
  }

  const [head, tail] = clientIp.split("::", 2);
  const headGroups = head ? head.split(":").filter(Boolean) : [];
  const tailGroups = tail ? tail.split(":").filter(Boolean) : [];
  // An embedded IPv4 literal is not a plain hextet, so leave the address whole
  // rather than risk mangling it into a different prefix.
  if ([...headGroups, ...tailGroups].some((group) => group.includes("."))) {
    return clientIp;
  }

  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array.from(
            { length: Math.max(8 - headGroups.length - tailGroups.length, 0) },
            () => "0",
          ),
          ...tailGroups,
        ];
  if (groups.length < 8) {
    return clientIp;
  }

  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join(":")}::/64`;
}

export function buildGenerationRateLimitKey(clientIp: string): string {
  return `ratelimit:v1:generate:${encodeURIComponent(toRateLimitBucket(clientIp))}`;
}

export function getGenerationRateLimitMessage(
  retryAfterSeconds: number,
): string {
  const minutes = Math.max(Math.ceil(retryAfterSeconds / 60), 1);
  return `Too many free generations from this network. I'm a solo student engineer running this free and open source, so please try again in about ${minutes} minute${minutes === 1 ? "" : "s"} or use your own API key.`;
}

export interface GenerationRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window per-IP limiter for generations billed to the server's own key.
 *
 * Callers bringing their own API key are not throttled here: they pay for their
 * own usage, so the shared daily budget is not at risk. Redis failures fail
 * open because the complimentary quota still bounds total spend, and a Redis
 * blip should not take generation down.
 */
export async function consumeGenerationRateLimit(params: {
  clientIp: string | null;
}): Promise<GenerationRateLimitResult> {
  if (!params.clientIp) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const windowSeconds = getGenerationRateLimitWindowSeconds();

  try {
    const result = await upstashEval<[number, number]>({
      script: GENERATION_RATE_LIMIT_SCRIPT,
      keys: [buildGenerationRateLimitKey(params.clientIp)],
      args: [getGenerationRateLimitMax(), windowSeconds],
    });

    return {
      allowed: result[0] === 1,
      retryAfterSeconds: result[1] > 0 ? result[1] : windowSeconds,
    };
  } catch {
    console.warn(
      JSON.stringify({
        event: "generate.rate_limit.unavailable",
        error: "Rate limit check failed; allowing the request.",
      }),
    );
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Returns a consumed slot when the request is rejected before any billable work
 * starts. The limiter runs first on purpose — it also shields the cancellation
 * registration behind it — so a caller who is turned away by a session conflict
 * or an unavailable Redis must not lose quota they never spent.
 */
export async function refundGenerationRateLimit(params: {
  clientIp: string | null;
}): Promise<void> {
  if (!params.clientIp) {
    return;
  }

  try {
    await upstashEval<number>({
      script: GENERATION_RATE_LIMIT_REFUND_SCRIPT,
      keys: [buildGenerationRateLimitKey(params.clientIp)],
      args: [],
    });
  } catch {
    console.warn(
      JSON.stringify({
        event: "generate.rate_limit.refund_failed",
        error: "Rate limit refund failed; the slot stays consumed.",
      }),
    );
  }
}
