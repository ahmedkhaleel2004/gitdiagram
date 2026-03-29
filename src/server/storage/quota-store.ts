import { upstashEval } from "~/server/storage/upstash";

const QUOTA_TTL_SECONDS = 3 * 24 * 60 * 60;

const RESERVE_SCRIPT = `
local key = KEYS[1]
local token_limit = tonumber(ARGV[1])
local reservation_tokens = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")
local reserved_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")

if used_tokens + reserved_tokens + reservation_tokens > token_limit then
  return {0, used_tokens, reserved_tokens}
end

local next_reserved_tokens = reserved_tokens + reservation_tokens
redis.call("HSET", key, "used_tokens", used_tokens, "reserved_tokens", next_reserved_tokens)
redis.call("EXPIRE", key, ttl)

return {1, used_tokens, next_reserved_tokens}
`;

const FINALIZE_SCRIPT = `
local key = KEYS[1]
local reservation_tokens = tonumber(ARGV[1])
local committed_tokens = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")
local reserved_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")

local next_reserved_tokens = reserved_tokens - reservation_tokens
if next_reserved_tokens < 0 then
  next_reserved_tokens = 0
end

local next_used_tokens = used_tokens + math.max(committed_tokens, 0)
redis.call("HSET", key, "used_tokens", next_used_tokens, "reserved_tokens", next_reserved_tokens)
redis.call("EXPIRE", key, ttl)

return {next_used_tokens, next_reserved_tokens}
`;

function quotaKey(quotaDateUtc: string, quotaBucket: string): string {
  const pricingModel = quotaBucket.split(":")[1] ?? quotaBucket;
  return `quota:v1:${quotaDateUtc}:${pricingModel}`;
}

export interface DailyQuotaUsage {
  usedTokens: number;
  reservedTokens: number;
}

export async function reserveQuotaInUpstash(params: {
  quotaDateUtc: string;
  quotaBucket: string;
  tokenLimit: number;
  reservationTokens: number;
}): Promise<{ admitted: boolean; usage: DailyQuotaUsage }> {
  const result = await upstashEval<[number, number, number]>({
    script: RESERVE_SCRIPT,
    keys: [quotaKey(params.quotaDateUtc, params.quotaBucket)],
    args: [params.tokenLimit, params.reservationTokens, QUOTA_TTL_SECONDS],
  });

  return {
    admitted: result[0] === 1,
    usage: {
      usedTokens: result[1] ?? 0,
      reservedTokens: result[2] ?? 0,
    },
  };
}

export async function finalizeQuotaInUpstash(params: {
  quotaDateUtc: string;
  quotaBucket: string;
  reservationTokens: number;
  committedTokens: number;
}): Promise<DailyQuotaUsage> {
  const result = await upstashEval<[number, number]>({
    script: FINALIZE_SCRIPT,
    keys: [quotaKey(params.quotaDateUtc, params.quotaBucket)],
    args: [
      params.reservationTokens,
      params.committedTokens,
      QUOTA_TTL_SECONDS,
    ],
  });

  return {
    usedTokens: result[0] ?? 0,
    reservedTokens: result[1] ?? 0,
  };
}
