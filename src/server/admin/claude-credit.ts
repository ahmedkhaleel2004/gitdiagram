import "server-only";

import type { ClaudeCredit } from "~/features/admin/types";
import { upstashCommand } from "~/server/storage/upstash";

// Anthropic has no API for the prepaid credit balance, only for what was spent.
// So the operator enters the balance the Console shows (after each top-up), and
// the dashboard subtracts everything the organization has spent since, read
// from the Admin API with ANTHROPIC_ADMIN_KEY. Auto-reload must stay off for
// the result to hold: a reload adds credit this can't see.
//
// The cost report is exact but only has finished UTC days, and the usage report
// only has finished hours or minutes. So the time since the balance was entered
// is split: minute buckets up to the next whole hour, hourly buckets to the end
// of that day, the cost report for whole days, then hourly and minute buckets
// again for today.

const API = "https://api.anthropic.com/v1/organizations";
const KEY = "admin:v1:claude-credit";
// Anthropic asks for at most one poll a minute; the dashboard polls every 5 s.
const CACHE_MS = 60_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// USD per million tokens at API list prices. Cache writes cost 1.25× input for
// 5 minutes and 2× for an hour. Unknown models are priced as the most
// expensive one, so the balance errs low.
const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number }
> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};
const FALLBACK_PRICE = PRICES["claude-fable-5-1"]!;
const WEB_SEARCH_USD = 0.01;

export type CostWindow =
  | { source: "usage"; width: "1m" | "1h"; from: number; to: number }
  | { source: "cost"; from: number; to: number };

const floorTo = (ms: number, unit: number) => Math.floor(ms / unit) * unit;
const ceilTo = (ms: number, unit: number) => Math.ceil(ms / unit) * unit;

/** The report windows that together cover [since, now) without overlap. */
export function costWindows(since: number, now: number): CostWindow[] {
  const start = ceilTo(since, MINUTE);
  const nextHour = ceilTo(start, HOUR);
  const nextDay = ceilTo(start, DAY);
  const today = floorTo(now, DAY);
  const thisHour = floorTo(now, HOUR);
  const windows: CostWindow[] = [];
  const usage = (width: "1m" | "1h", from: number, to: number) => {
    if (to > from) windows.push({ source: "usage", width, from, to });
  };

  if (nextHour > thisHour) {
    usage("1m", start, now);
    return windows;
  }
  usage("1m", start, nextHour);
  if (nextDay <= today) {
    usage("1h", nextHour, nextDay);
    if (today > nextDay)
      windows.push({ source: "cost", from: nextDay, to: today });
    usage("1h", today, thisHour);
  } else {
    usage("1h", nextHour, thisHour);
  }
  usage("1m", thisHour, now);
  return windows;
}

interface UsageResult {
  model: string | null;
  uncached_input_tokens: number;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number;
    ephemeral_5m_input_tokens?: number;
  };
  cache_read_input_tokens: number;
  output_tokens: number;
  server_tool_use?: { web_search_requests?: number };
}

/** List-price cost in USD of one usage report row. */
export function priceUsage(row: UsageResult): number {
  const price = (row.model && PRICES[row.model]) || FALLBACK_PRICE;
  const writes = row.cache_creation ?? {};
  const tokens =
    row.uncached_input_tokens * price.input +
    (writes.ephemeral_5m_input_tokens ?? 0) * price.input * 1.25 +
    (writes.ephemeral_1h_input_tokens ?? 0) * price.input * 2 +
    row.cache_read_input_tokens * price.cacheRead +
    row.output_tokens * price.output;
  return (
    tokens / 1_000_000 +
    (row.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD
  );
}

async function report<T>(
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_ADMIN_KEY is not set.");
  const rows: T[] = [];
  let page: string | null = null;
  do {
    const query = new URLSearchParams(params);
    if (page) query.set("page", page);
    const response = await fetch(`${API}/${path}?${query}`, {
      headers: { "anthropic-version": "2023-06-01", "x-api-key": key },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok)
      throw new Error(`Anthropic ${path} failed (${response.status})`);
    const body = (await response.json()) as {
      data: { results: T[] }[];
      has_more: boolean;
      next_page: string | null;
    };
    for (const bucket of body.data) rows.push(...bucket.results);
    page = body.has_more ? body.next_page : null;
  } while (page);
  return rows;
}

async function windowCost(window: CostWindow): Promise<number> {
  const range = {
    starting_at: new Date(window.from).toISOString(),
    ending_at: new Date(window.to).toISOString(),
  };
  if (window.source === "cost") {
    // Amounts are decimal strings in cents.
    const rows = await report<{ amount: string }>("cost_report", {
      ...range,
      limit: "31",
    });
    return rows.reduce((sum, row) => sum + Number(row.amount) / 100, 0);
  }
  const rows = await report<UsageResult>("usage_report/messages", {
    ...range,
    bucket_width: window.width,
    limit: window.width === "1m" ? "1440" : "168",
    "group_by[]": "model",
  });
  return rows.reduce((sum, row) => sum + priceUsage(row), 0);
}

/** The balance the operator last read off the Console, and when. */
async function readAnchor(): Promise<{ usd: number; at: number } | null> {
  const fields = await upstashCommand<string[] | null>(["HGETALL", KEY]);
  const map = new Map<string, string>();
  for (let index = 0; index + 1 < (fields?.length ?? 0); index += 2)
    map.set(fields![index]!, fields![index + 1]!);
  const usd = Number(map.get("usd"));
  const at = Number(map.get("at"));
  return Number.isFinite(usd) && Number.isSafeInteger(at) && at > 0
    ? { usd, at }
    : null;
}

let cache: { at: number; credit: Promise<ClaudeCredit | null> } | null = null;

async function computeCredit(now: number): Promise<ClaudeCredit | null> {
  if (!process.env.ANTHROPIC_ADMIN_KEY?.trim()) return null;
  const anchor = await readAnchor();
  if (!anchor) return { setUsd: null, setAt: null, spentUsd: 0 };
  const costs = await Promise.all(
    costWindows(Math.min(anchor.at, now), now).map(windowCost),
  );
  const spentUsd = costs.reduce((sum, cost) => sum + cost, 0);
  return { setUsd: anchor.usd, setAt: anchor.at, spentUsd };
}

/**
 * The Claude API credit left, as the last entered Console balance minus the
 * spend since. Null when there is no admin key; throws when a report fails.
 */
export function readClaudeCredit(): Promise<ClaudeCredit | null> {
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_MS) {
    const credit = computeCredit(now);
    cache = { at: now, credit };
    // A failed read is not cached, so the next poll tries again.
    credit.catch(() => {
      if (cache?.credit === credit) cache = null;
    });
  }
  return cache.credit;
}

/** Record the balance the Console shows right now, e.g. after a top-up. */
export async function setClaudeCredit(usd: number): Promise<void> {
  await upstashCommand(["HSET", KEY, "usd", String(usd), "at", Date.now()]);
  cache = null;
}
