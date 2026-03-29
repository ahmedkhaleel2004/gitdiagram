import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env" });

function readEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function quotaKey(quotaDateUtc, quotaBucket) {
  const pricingModel = quotaBucket.split(":")[1] ?? quotaBucket;
  return `quota:v1:${quotaDateUtc}:${pricingModel}`;
}

async function fetchUpstashResult(path, body) {
  const url = `${readEnv("UPSTASH_REDIS_REST_URL").replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${readEnv("UPSTASH_REDIS_REST_TOKEN")}`,
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

const tokenLimit = Number.parseInt(
  readEnv("OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS") || "10000000",
  10,
);
const modelFamily =
  readEnv("OPENAI_COMPLIMENTARY_MODEL_FAMILY")?.toLowerCase() ||
  "gpt-5.4-mini";
const quotaDateUtc = new Date().toISOString().slice(0, 10);
const quotaBucket = `openai:${modelFamily}:complimentary`;
const quotaBackend = readEnv("QUOTA_BACKEND")?.toLowerCase() || "postgres";

let usedTokens = 0;
let reservedTokens = 0;

if (quotaBackend === "upstash") {
  if (!readEnv("UPSTASH_REDIS_REST_URL") || !readEnv("UPSTASH_REDIS_REST_TOKEN")) {
    throw new Error("Missing Upstash Redis REST configuration in .env");
  }

  const result = await fetchUpstashResult("", [
    "HMGET",
    quotaKey(quotaDateUtc, quotaBucket),
    "used_tokens",
    "reserved_tokens",
  ]);
  usedTokens = Number.parseInt(result?.[0] ?? "0", 10) || 0;
  reservedTokens = Number.parseInt(result?.[1] ?? "0", 10) || 0;
} else {
  const databaseUrl = readEnv("POSTGRES_URL");
  if (!databaseUrl) {
    throw new Error("Missing POSTGRES_URL in .env");
  }

  const sql = postgres(databaseUrl);
  const rows = await sql.unsafe(
    `
      select
        quota_date_utc as "quotaDateUtc",
        quota_bucket as "quotaBucket",
        used_tokens as "usedTokens",
        reserved_tokens as "reservedTokens"
      from gitdiagram_openai_daily_quota
      where quota_date_utc = $1
        and quota_bucket = $2
      limit 1
    `,
    [quotaDateUtc, quotaBucket],
  );
  await sql.end();

  const row = rows[0];
  usedTokens = row?.usedTokens ?? 0;
  reservedTokens = row?.reservedTokens ?? 0;
}

const remainingTokens = Math.max(tokenLimit - usedTokens - reservedTokens, 0);

console.log(`Backend:         ${quotaBackend}`);
console.log(`UTC date:        ${quotaDateUtc}`);
console.log(`Bucket:          ${quotaBucket}`);
console.log(`Daily limit:     ${tokenLimit.toLocaleString()}`);
console.log(`Used:            ${usedTokens.toLocaleString()}`);
console.log(`Reserved:        ${reservedTokens.toLocaleString()}`);
console.log(`Remaining:       ${remainingTokens.toLocaleString()}`);
