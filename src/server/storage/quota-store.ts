import { upstashEval } from "~/server/storage/upstash";

const QUOTA_TTL_SECONDS = 3 * 24 * 60 * 60;

export const QUOTA_CHECK_SCRIPT = `
local key = KEYS[1]
local token_limit = tonumber(ARGV[1])
local requested_tokens = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local reservation_field = "reservation:" .. ARGV[4]

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")
local reserved_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")
local existing_reservation = redis.call("HGET", key, reservation_field)

if existing_reservation then
  return {1, used_tokens}
end

if used_tokens + reserved_tokens + requested_tokens > token_limit then
  return {0, used_tokens}
end

redis.call("HSET", key, reservation_field, requested_tokens)
redis.call("HSET", key, "reserved_tokens", reserved_tokens + requested_tokens)
redis.call("EXPIRE", key, ttl)

return {1, used_tokens}
`;

export const QUOTA_FINALIZE_SCRIPT = `
local key = KEYS[1]
local committed_tokens = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local reservation_field = "reservation:" .. ARGV[3]
local finalized_field = "finalized:" .. ARGV[3]

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")
local reserved_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")
local reservation_tokens = tonumber(redis.call("HGET", key, reservation_field))

if redis.call("HEXISTS", key, finalized_field) == 1 then
  return used_tokens
end

if not reservation_tokens then
  return used_tokens
end

local next_used_tokens = used_tokens + math.max(committed_tokens, 0)
local next_reserved_tokens = math.max(reserved_tokens - math.max(reservation_tokens, 0), 0)
redis.call("HSET", key, "used_tokens", next_used_tokens)
redis.call("HDEL", key, reservation_field)
redis.call("HSET", key, finalized_field, committed_tokens)
if next_reserved_tokens == 0 then
  redis.call("HDEL", key, "reserved_tokens")
else
  redis.call("HSET", key, "reserved_tokens", next_reserved_tokens)
end
redis.call("EXPIRE", key, ttl)

return next_used_tokens
`;

export function buildQuotaKey(
  quotaDateUtc: string,
  quotaBucket: string,
): string {
  const normalizedBucket = encodeURIComponent(quotaBucket.trim().toLowerCase());
  return `quota:v2:${quotaDateUtc}:${normalizedBucket}`;
}

export interface DailyQuotaUsage {
  usedTokens: number;
}

export async function checkQuotaInUpstash(params: {
  quotaDateUtc: string;
  quotaBucket: string;
  tokenLimit: number;
  requestedTokens: number;
  reservationId: string;
}): Promise<{ admitted: boolean; usage: DailyQuotaUsage }> {
  const result = await upstashEval<[number, number]>({
    script: QUOTA_CHECK_SCRIPT,
    keys: [buildQuotaKey(params.quotaDateUtc, params.quotaBucket)],
    args: [
      params.tokenLimit,
      params.requestedTokens,
      QUOTA_TTL_SECONDS,
      params.reservationId,
    ],
  });

  return {
    admitted: result[0] === 1,
    usage: {
      usedTokens: result[1] ?? 0,
    },
  };
}

export async function commitQuotaUsageInUpstash(params: {
  quotaDateUtc: string;
  quotaBucket: string;
  committedTokens: number;
  reservationId: string;
}): Promise<DailyQuotaUsage> {
  const usedTokens = await upstashEval<number>({
    script: QUOTA_FINALIZE_SCRIPT,
    keys: [buildQuotaKey(params.quotaDateUtc, params.quotaBucket)],
    args: [params.committedTokens, QUOTA_TTL_SECONDS, params.reservationId],
  });

  return {
    usedTokens: usedTokens ?? 0,
  };
}
