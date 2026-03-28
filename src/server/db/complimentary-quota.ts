import { getQuotaSqlClient } from "~/server/db/quota-client";

export interface DailyQuotaUsage {
  usedTokens: number;
  reservedTokens: number;
}

export async function reserveComplimentaryQuota(params: {
  quotaDateUtc: string;
  quotaBucket: string;
  tokenLimit: number;
  reservationTokens: number;
}): Promise<{ admitted: boolean; usage: DailyQuotaUsage }> {
  const sql = getQuotaSqlClient();

  return sql.begin(async (tx) => {
    await tx.unsafe(
      `
        insert into gitdiagram_openai_daily_quota (
          quota_date_utc,
          quota_bucket,
          used_tokens,
          reserved_tokens
        )
        values ($1, $2, 0, 0)
        on conflict (quota_date_utc, quota_bucket) do nothing
      `,
      [params.quotaDateUtc, params.quotaBucket],
    );

    const rows = await tx.unsafe<DailyQuotaUsage[]>(
      `
        select used_tokens as "usedTokens", reserved_tokens as "reservedTokens"
        from gitdiagram_openai_daily_quota
        where quota_date_utc = $1
          and quota_bucket = $2
        for update
      `,
      [params.quotaDateUtc, params.quotaBucket],
    );
    const current = rows[0];

    if (!current) {
      throw new Error("Complimentary quota row could not be loaded.");
    }

    if (
      current.usedTokens +
        current.reservedTokens +
        params.reservationTokens >
      params.tokenLimit
    ) {
      return {
        admitted: false,
        usage: current,
      };
    }

    await tx.unsafe(
      `
        update gitdiagram_openai_daily_quota
        set reserved_tokens = reserved_tokens + $1,
            updated_at = current_timestamp
        where quota_date_utc = $2
          and quota_bucket = $3
      `,
      [
        params.reservationTokens,
        params.quotaDateUtc,
        params.quotaBucket,
      ],
    );

    return {
      admitted: true,
      usage: {
        usedTokens: current.usedTokens,
        reservedTokens: current.reservedTokens + params.reservationTokens,
      },
    };
  });
}

export async function finalizeComplimentaryQuota(params: {
  quotaDateUtc: string;
  quotaBucket: string;
  reservationTokens: number;
  committedTokens: number;
}): Promise<DailyQuotaUsage> {
  const sql = getQuotaSqlClient();

  return sql.begin(async (tx) => {
    await tx.unsafe(
      `
        insert into gitdiagram_openai_daily_quota (
          quota_date_utc,
          quota_bucket,
          used_tokens,
          reserved_tokens
        )
        values ($1, $2, 0, 0)
        on conflict (quota_date_utc, quota_bucket) do nothing
      `,
      [params.quotaDateUtc, params.quotaBucket],
    );

    const rows = await tx.unsafe<DailyQuotaUsage[]>(
      `
        select used_tokens as "usedTokens", reserved_tokens as "reservedTokens"
        from gitdiagram_openai_daily_quota
        where quota_date_utc = $1
          and quota_bucket = $2
        for update
      `,
      [params.quotaDateUtc, params.quotaBucket],
    );
    const current = rows[0];

    if (!current) {
      throw new Error("Complimentary quota row could not be loaded.");
    }

    const nextReservedTokens = Math.max(
      current.reservedTokens - params.reservationTokens,
      0,
    );
    const nextUsedTokens = current.usedTokens + Math.max(params.committedTokens, 0);

    await tx.unsafe(
      `
        update gitdiagram_openai_daily_quota
        set used_tokens = $1,
            reserved_tokens = $2,
            updated_at = current_timestamp
        where quota_date_utc = $3
          and quota_bucket = $4
      `,
      [
        nextUsedTokens,
        nextReservedTokens,
        params.quotaDateUtc,
        params.quotaBucket,
      ],
    );

    return {
      usedTokens: nextUsedTokens,
      reservedTokens: nextReservedTokens,
    };
  });
}
