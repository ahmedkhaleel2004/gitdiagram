import { getQuotaSqlClient } from "~/server/db/quota-client";
import {
  getComplimentaryDailyLimitTokens,
  getComplimentaryModelFamily,
} from "~/server/generate/complimentary-gate";

export interface ComplimentaryQuotaStats {
  quotaDateUtc: string;
  quotaBucket: string;
  usedTokens: number;
  reservedTokens: number;
  remainingTokens: number;
  tokenLimit: number;
}

export async function getComplimentaryQuotaStats(params?: {
  quotaDateUtc?: string;
  quotaBucket?: string;
}): Promise<ComplimentaryQuotaStats> {
  const sql = getQuotaSqlClient();
  const tokenLimit = getComplimentaryDailyLimitTokens();
  const quotaDateUtc =
    params?.quotaDateUtc ?? new Date().toISOString().slice(0, 10);
  const quotaBucket =
    params?.quotaBucket ??
    `openai:${getComplimentaryModelFamily()}:complimentary`;

  const rows = await sql.unsafe<
    Array<{
      quotaDateUtc: string;
      quotaBucket: string;
      usedTokens: number;
      reservedTokens: number;
    }>
  >(
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

  const row = rows[0];
  const usedTokens = row?.usedTokens ?? 0;
  const reservedTokens = row?.reservedTokens ?? 0;

  return {
    quotaDateUtc,
    quotaBucket,
    usedTokens,
    reservedTokens,
    remainingTokens: Math.max(tokenLimit - usedTokens - reservedTokens, 0),
    tokenLimit,
  };
}
