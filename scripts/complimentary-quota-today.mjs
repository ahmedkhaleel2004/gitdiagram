import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env" });

const databaseUrl = process.env.POSTGRES_URL?.trim();
if (!databaseUrl) {
  throw new Error("Missing POSTGRES_URL in .env");
}

const tokenLimit = Number.parseInt(
  process.env.OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS?.trim() || "10000000",
  10,
);
const modelFamily =
  process.env.OPENAI_COMPLIMENTARY_MODEL_FAMILY?.trim().toLowerCase() ||
  "gpt-5.4-mini";
const quotaDateUtc = new Date().toISOString().slice(0, 10);
const quotaBucket = `openai:${modelFamily}:complimentary`;

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
const usedTokens = row?.usedTokens ?? 0;
const reservedTokens = row?.reservedTokens ?? 0;
const remainingTokens = Math.max(tokenLimit - usedTokens - reservedTokens, 0);

console.log(`UTC date:        ${quotaDateUtc}`);
console.log(`Bucket:          ${quotaBucket}`);
console.log(`Daily limit:     ${tokenLimit.toLocaleString()}`);
console.log(`Used:            ${usedTokens.toLocaleString()}`);
console.log(`Reserved:        ${reservedTokens.toLocaleString()}`);
console.log(`Remaining:       ${remainingTokens.toLocaleString()}`);
