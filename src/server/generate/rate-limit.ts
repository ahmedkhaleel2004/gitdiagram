import { upstashEval } from "~/server/storage/upstash";

const DEFAULT_MAX_GENERATIONS = 8;
const DEFAULT_WINDOW_SECONDS = 60 * 60;
const DEFAULT_MAX_INFRASTRUCTURE_REQUESTS = 60;

const GENERATION_RATE_LIMIT_SCRIPT = `
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

export function getGenerationInfrastructureRateLimitMax(): number {
  return readEnvInt(
    "GENERATION_INFRASTRUCTURE_RATE_LIMIT_MAX",
    DEFAULT_MAX_INFRASTRUCTURE_REQUESTS,
  );
}

function getGenerationInfrastructureRateLimitWindowSeconds(): number {
  return readEnvInt(
    "GENERATION_INFRASTRUCTURE_RATE_LIMIT_WINDOW_SECONDS",
    DEFAULT_WINDOW_SECONDS,
  );
}

const GENERATION_RATE_LIMIT_REFUND_SCRIPT = `
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

export function buildGenerationInfrastructureRateLimitKey(
  clientIp: string,
): string {
  return `ratelimit:v1:generate-infrastructure:${encodeURIComponent(toRateLimitBucket(clientIp))}`;
}

export function getGenerationRateLimitMessage(
  retryAfterSeconds: number,
): string {
  const minutes = Math.max(Math.ceil(retryAfterSeconds / 60), 1);
  return `Too many free generations from this network. I'm a solo student engineer running this free and open source, so please try again in about ${minutes} minute${minutes === 1 ? "" : "s"} or use your own API key.`;
}

export function getGenerationInfrastructureRateLimitMessage(
  retryAfterSeconds: number,
): string {
  const minutes = Math.max(Math.ceil(retryAfterSeconds / 60), 1);
  return `Too many repository analysis requests from this network. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export interface GenerationRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  consumed: boolean;
}

async function consumeRateLimit(params: {
  clientIp: string | null;
  buildKey: (clientIp: string) => string;
  max: number;
  windowSeconds: number;
  unavailableEvent: string;
}): Promise<GenerationRateLimitResult> {
  if (!params.clientIp) {
    return { allowed: true, retryAfterSeconds: 0, consumed: false };
  }

  try {
    const result = await upstashEval<[number, number]>({
      script: GENERATION_RATE_LIMIT_SCRIPT,
      keys: [params.buildKey(params.clientIp)],
      args: [params.max, params.windowSeconds],
    });

    return {
      allowed: result[0] === 1,
      retryAfterSeconds: result[1] > 0 ? result[1] : params.windowSeconds,
      consumed: true,
    };
  } catch {
    console.warn(
      JSON.stringify({
        event: params.unavailableEvent,
        error: "Rate limit check failed; allowing the request.",
      }),
    );
    return { allowed: true, retryAfterSeconds: 0, consumed: false };
  }
}

/**
 * Fixed-window per-IP limiter for generations billed to the server's own key.
 * BYOK callers skip this spend limiter, but never the separate infrastructure
 * limiter below.
 */
export function consumeGenerationRateLimit(params: {
  clientIp: string | null;
}): Promise<GenerationRateLimitResult> {
  return consumeRateLimit({
    ...params,
    buildKey: buildGenerationRateLimitKey,
    max: getGenerationRateLimitMax(),
    windowSeconds: getGenerationRateLimitWindowSeconds(),
    unavailableEvent: "generate.rate_limit.unavailable",
  });
}

/**
 * Bounds GitHub API, repository parsing, and session-registration work for all
 * callers, including callers presenting an arbitrary or invalid model key.
 */
export function consumeGenerationInfrastructureRateLimit(params: {
  clientIp: string | null;
}): Promise<GenerationRateLimitResult> {
  return consumeRateLimit({
    ...params,
    buildKey: buildGenerationInfrastructureRateLimitKey,
    max: getGenerationInfrastructureRateLimitMax(),
    windowSeconds: getGenerationInfrastructureRateLimitWindowSeconds(),
    unavailableEvent: "generate.infrastructure_rate_limit.unavailable",
  });
}

async function refundRateLimit(params: {
  clientIp: string | null;
  buildKey: (clientIp: string) => string;
  failureEvent: string;
}): Promise<void> {
  if (!params.clientIp) {
    return;
  }

  try {
    await upstashEval<number>({
      script: GENERATION_RATE_LIMIT_REFUND_SCRIPT,
      keys: [params.buildKey(params.clientIp)],
      args: [],
    });
  } catch {
    console.warn(
      JSON.stringify({
        event: params.failureEvent,
        error: "Rate limit refund failed; the slot stays consumed.",
      }),
    );
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
  return refundRateLimit({
    ...params,
    buildKey: buildGenerationRateLimitKey,
    failureEvent: "generate.rate_limit.refund_failed",
  });
}

export async function refundGenerationInfrastructureRateLimit(params: {
  clientIp: string | null;
}): Promise<void> {
  return refundRateLimit({
    ...params,
    buildKey: buildGenerationInfrastructureRateLimitKey,
    failureEvent: "generate.infrastructure_rate_limit.refund_failed",
  });
}
