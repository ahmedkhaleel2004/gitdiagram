import { upstashEval } from "~/server/storage/upstash";
import { resolvePricingModel } from "~/server/generate/pricing";

const QUOTA_TTL_SECONDS = 3 * 24 * 60 * 60;

const CHECK_SCRIPT = `
local key = KEYS[1]
local token_limit = tonumber(ARGV[1])
local requested_tokens = tonumber(ARGV[2])

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")

if used_tokens + requested_tokens > token_limit then
  return {0, used_tokens}
end

return {1, used_tokens}
`;

const FINALIZE_SCRIPT = `
local key = KEYS[1]
local committed_tokens = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")

local next_used_tokens = used_tokens + math.max(committed_tokens, 0)
redis.call("HSET", key, "used_tokens", next_used_tokens)
redis.call("HDEL", key, "reserved_tokens")
redis.call("EXPIRE", key, ttl)

return next_used_tokens
`;

export function buildQuotaKey(quotaDateUtc: string, quotaBucket: string): string {
  const rawPricingModel = quotaBucket.split(":")[1] ?? quotaBucket;
  const pricingModel = resolvePricingModel(rawPricingModel);
  return `quota:v1:${quotaDateUtc}:${pricingModel}`;
}

export interface DailyQuotaUsage {
  usedTokens: number;
}

export async function checkQuotaInUpstash(params: {
  quotaDateUtc: string;
  quotaBucket: string;
  tokenLimit: number;
  requestedTokens: number;
}): Promise<{ admitted: boolean; usage: DailyQuotaUsage }> {
  const result = await upstashEval<[number, number]>({
    script: CHECK_SCRIPT,
    keys: [buildQuotaKey(params.quotaDateUtc, params.quotaBucket)],
    args: [params.tokenLimit, params.requestedTokens],
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
}): Promise<DailyQuotaUsage> {
  const usedTokens = await upstashEval<number>({
    script: FINALIZE_SCRIPT,
    keys: [buildQuotaKey(params.quotaDateUtc, params.quotaBucket)],
    args: [params.committedTokens, QUOTA_TTL_SECONDS],
  });

  return {
    usedTokens: usedTokens ?? 0,
  };
}
