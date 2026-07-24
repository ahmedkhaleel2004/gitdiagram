import { upstashEval } from "~/server/storage/upstash";

const QUOTA_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * How long an admitted reservation may hold budget before it is reclaimable.
 * Generations are bounded well below this by the route deadline, so a lease
 * only expires when the process died without finalizing.
 */
export const QUOTA_RESERVATION_LEASE_MS = 6 * 60 * 1000;

export const QUOTA_CHECK_SCRIPT = `
local key = KEYS[1]
local leases_key = KEYS[2]
local token_limit = tonumber(ARGV[1])
local requested_tokens = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local reservation_id = ARGV[4]
local now_ms = tonumber(ARGV[5])
local lease_ms = tonumber(ARGV[6])
local reservation_field = "reservation:" .. reservation_id

-- Reclaim leases that expired because a generation process died before it could
-- finalize. Without this, reserved tokens leak for the rest of the UTC day and
-- can lock out the daily budget without any real usage behind it. Each reclaim
-- leaves a marker so a late finalize still charges the tokens it actually spent.
local expired = redis.call("ZRANGEBYSCORE", leases_key, "-inf", now_ms)
if #expired > 0 then
  local reclaimed_tokens = 0
  for index = 1, #expired do
    local expired_field = "reservation:" .. expired[index]
    local expired_tokens = tonumber(redis.call("HGET", key, expired_field))
    if expired_tokens then
      reclaimed_tokens = reclaimed_tokens + expired_tokens
      redis.call("HDEL", key, expired_field)
      redis.call("HSET", key, "reclaimed:" .. expired[index], expired_tokens)
    end
  end
  redis.call("ZREMRANGEBYSCORE", leases_key, "-inf", now_ms)
  if reclaimed_tokens > 0 then
    local held_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")
    local remaining_tokens = math.max(held_tokens - reclaimed_tokens, 0)
    if remaining_tokens == 0 then
      redis.call("HDEL", key, "reserved_tokens")
    else
      redis.call("HSET", key, "reserved_tokens", remaining_tokens)
    end
  end
end

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")
local reserved_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")
local existing_reservation = redis.call("HGET", key, reservation_field)

if existing_reservation then
  redis.call("ZADD", leases_key, now_ms + lease_ms, reservation_id)
  redis.call("EXPIRE", leases_key, ttl)
  return {1, used_tokens}
end

if used_tokens + reserved_tokens + requested_tokens > token_limit then
  return {0, used_tokens}
end

redis.call("HSET", key, reservation_field, requested_tokens)
redis.call("HSET", key, "reserved_tokens", reserved_tokens + requested_tokens)
redis.call("ZADD", leases_key, now_ms + lease_ms, reservation_id)
redis.call("EXPIRE", key, ttl)
redis.call("EXPIRE", leases_key, ttl)

return {1, used_tokens}
`;

export const QUOTA_FINALIZE_SCRIPT = `
local key = KEYS[1]
local leases_key = KEYS[2]
local committed_tokens = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local reservation_id = ARGV[3]
local reservation_field = "reservation:" .. reservation_id
local finalized_field = "finalized:" .. reservation_id
local reclaimed_field = "reclaimed:" .. reservation_id

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")
local reserved_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")
local reservation_tokens = tonumber(redis.call("HGET", key, reservation_field))
local reclaimed_tokens = tonumber(redis.call("HGET", key, reclaimed_field))

if redis.call("HEXISTS", key, finalized_field) == 1 then
  return used_tokens
end

-- A reservation this finalize never held is a no-op: it is either an unknown id
-- or a mismatched quota key, and neither should move the daily counter.
if not reservation_tokens and not reclaimed_tokens then
  return used_tokens
end

local next_used_tokens = used_tokens + math.max(committed_tokens, 0)
redis.call("HSET", key, "used_tokens", next_used_tokens)
redis.call("HDEL", key, reservation_field)
redis.call("HDEL", key, reclaimed_field)
redis.call("HSET", key, finalized_field, committed_tokens)
redis.call("ZREM", leases_key, reservation_id)

-- Reclaimed leases already gave their tokens back, so only a lease still held by
-- this reservation may be subtracted from the outstanding total.
if reservation_tokens then
  local next_reserved_tokens = math.max(reserved_tokens - math.max(reservation_tokens, 0), 0)
  if next_reserved_tokens == 0 then
    redis.call("HDEL", key, "reserved_tokens")
  else
    redis.call("HSET", key, "reserved_tokens", next_reserved_tokens)
  end
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

export function buildQuotaLeaseKey(
  quotaDateUtc: string,
  quotaBucket: string,
): string {
  return `${buildQuotaKey(quotaDateUtc, quotaBucket)}:leases`;
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
  nowMs?: number;
}): Promise<{ admitted: boolean; usage: DailyQuotaUsage }> {
  const result = await upstashEval<[number, number]>({
    script: QUOTA_CHECK_SCRIPT,
    keys: [
      buildQuotaKey(params.quotaDateUtc, params.quotaBucket),
      buildQuotaLeaseKey(params.quotaDateUtc, params.quotaBucket),
    ],
    args: [
      params.tokenLimit,
      params.requestedTokens,
      QUOTA_TTL_SECONDS,
      params.reservationId,
      params.nowMs ?? Date.now(),
      QUOTA_RESERVATION_LEASE_MS,
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
    keys: [
      buildQuotaKey(params.quotaDateUtc, params.quotaBucket),
      buildQuotaLeaseKey(params.quotaDateUtc, params.quotaBucket),
    ],
    args: [params.committedTokens, QUOTA_TTL_SECONDS, params.reservationId],
  });

  return {
    usedTokens: usedTokens ?? 0,
  };
}
