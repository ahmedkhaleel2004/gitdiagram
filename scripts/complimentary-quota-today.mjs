import { config } from "dotenv";
import {
  getComplimentaryDailyLimitTokens,
  getComplimentaryModelFamily,
} from "../src/server/generate/complimentary-gate";
import { buildQuotaKey } from "../src/server/storage/quota-store";

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

const tokenLimit = getComplimentaryDailyLimitTokens();
const modelFamily = getComplimentaryModelFamily();
const quotaDateUtc = new Date().toISOString().slice(0, 10);
const quotaBucket = `openai:${modelFamily}:complimentary`;

const result = await fetchUpstashResult([
  "HMGET",
  buildQuotaKey(quotaDateUtc, quotaBucket),
  "used_tokens",
]);

const usedTokens = Number.parseInt(result?.[0] ?? "0", 10) || 0;
const remainingTokens = Math.max(tokenLimit - usedTokens, 0);

console.log("Backend:         upstash");
console.log(`UTC date:        ${quotaDateUtc}`);
console.log(`Bucket:          ${quotaBucket}`);
console.log(`Daily limit:     ${tokenLimit.toLocaleString()}`);
console.log(`Used exact:      ${usedTokens.toLocaleString()}`);
console.log(`Remaining exact: ${remainingTokens.toLocaleString()}`);
