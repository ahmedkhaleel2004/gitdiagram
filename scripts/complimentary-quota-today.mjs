import { config } from "dotenv";

config({ path: ".env" });

function readEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

async function fetchUpstashResult(body) {
  const baseUrl = readEnv("UPSTASH_REDIS_REST_URL");
  const token = readEnv("UPSTASH_REDIS_REST_TOKEN");
  if (!baseUrl || !token) {
    throw new Error("Missing Upstash Redis REST configuration in .env");
  }

  const response = await fetch(baseUrl.replace(/\/$/, ""), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Upstash request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`Upstash command failed: ${payload.error}`);
  }

  return payload.result;
}

function quotaKey(quotaDateUtc, quotaBucket) {
  const pricingModel = quotaBucket.split(":")[1] ?? quotaBucket;
  return `quota:v1:${quotaDateUtc}:${pricingModel}`;
}

const tokenLimit = Number.parseInt(
  readEnv("OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS") || "10000000",
  10,
);
const modelFamily =
  readEnv("OPENAI_COMPLIMENTARY_MODEL_FAMILY")?.toLowerCase() ||
  "gpt-5.4-mini";
const quotaDateUtc = new Date().toISOString().slice(0, 10);
const quotaBucket = `openai:${modelFamily}:complimentary`;

const result = await fetchUpstashResult([
  "HMGET",
  quotaKey(quotaDateUtc, quotaBucket),
  "used_tokens",
  "reserved_tokens",
]);

const usedTokens = Number.parseInt(result?.[0] ?? "0", 10) || 0;
const reservedTokens = Number.parseInt(result?.[1] ?? "0", 10) || 0;
const remainingTokens = Math.max(tokenLimit - usedTokens - reservedTokens, 0);

console.log("Backend:         upstash");
console.log(`UTC date:        ${quotaDateUtc}`);
console.log(`Bucket:          ${quotaBucket}`);
console.log(`Daily limit:     ${tokenLimit.toLocaleString()}`);
console.log(`Used:            ${usedTokens.toLocaleString()}`);
console.log(`Reserved:        ${reservedTokens.toLocaleString()}`);
console.log(`Remaining:       ${remainingTokens.toLocaleString()}`);
