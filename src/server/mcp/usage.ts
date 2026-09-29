import "server-only";

import { createHash } from "node:crypto";

import { networkOf } from "~/lib/network";
import {
  consumeRateLimit,
  readEnvInt,
  type GenerationRateLimitResult,
} from "~/server/generate/rate-limit";
import { upstashEval } from "~/server/storage/upstash";

// Abuse control and usage counts for the MCP server (/mcp). Every tool call
// takes a slot from a per-network fixed window (like the generation limiters,
// failing open when Redis is down, since each call is only a cached read), and
// is counted per tool in one Redis hash per UTC day, so the operator can see
// how much agents use GitDiagram. Handshakes are counted by client name
// (claude-code, cursor, …) in the same hash.

const DEFAULT_MAX_CALLS = 120;
const DEFAULT_WINDOW_SECONDS = 60 * 60;
/** A network calling for many named people may make this many times more. */
const SHARED_NETWORK_MULTIPLIER = 20;
const RETENTION_SECONDS = 120 * 24 * 60 * 60;
/** One feed line per network, tool and repository at most this often. */
const NOTICE_SECONDS = 10 * 60;
/** Past this many fields in a day's hash, new client names count as "other". */
const MAX_DAY_FIELDS = 200;

export type McpToolName =
  "get_repository_diagram" | "find_repository_diagrams" | "get_explainer_video";

/** How a tool call ended, for the counts and the /admin feed. */
export type McpOutcome = "found" | "missing" | "invalid" | "limited" | "error";

function getMcpRateLimitMax(): number {
  return readEnvInt("MCP_RATE_LIMIT_MAX", DEFAULT_MAX_CALLS);
}

function getMcpRateLimitWindowSeconds(): number {
  return readEnvInt("MCP_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS);
}

function buildMcpRateLimitKey(
  clientIp: string,
  windowStartSeconds: number,
): string {
  return `ratelimit:v2:mcp:${encodeURIComponent(networkOf(clientIp))}:${windowStartSeconds}`;
}

/**
 * The person a chat app says it is calling for: ChatGPT sends an anonymized
 * user id (`_meta["openai/subject"]`) with each tool call. Hashed, since it
 * only needs to tell people apart.
 */
export function mcpCallerKey(subject: unknown): string | null {
  if (typeof subject !== "string") return null;
  const trimmed = subject.trim();
  if (!trimmed || trimmed.length > 256) return null;
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 24);
}

/**
 * Takes one tool call's slot. A chat app such as ChatGPT calls from its own
 * few addresses for everyone using it, so when it names the person (see
 * mcpCallerKey), that person gets the usual allowance, and the network as a
 * whole a looser one, instead of everyone sharing one network's allowance.
 */
export async function consumeMcpRateLimit(
  clientIp: string | null,
  caller: string | null = null,
): Promise<GenerationRateLimitResult> {
  const max = getMcpRateLimitMax();
  const windowSeconds = getMcpRateLimitWindowSeconds();
  if (!caller)
    return consumeRateLimit({
      clientIp,
      buildKey: buildMcpRateLimitKey,
      max,
      windowSeconds,
      unavailableEvent: "mcp.rate_limit.unavailable",
    });
  const [person, network] = await Promise.all([
    consumeRateLimit({
      clientIp,
      buildKey: (ip, windowStart) =>
        `ratelimit:v2:mcp-caller:${encodeURIComponent(networkOf(ip))}:${caller}:${windowStart}`,
      max,
      windowSeconds,
      unavailableEvent: "mcp.rate_limit.unavailable",
    }),
    consumeRateLimit({
      clientIp,
      buildKey: (ip, windowStart) =>
        `ratelimit:v2:mcp-shared:${encodeURIComponent(networkOf(ip))}:${windowStart}`,
      max: max * SHARED_NETWORK_MULTIPLIER,
      windowSeconds,
      unavailableEvent: "mcp.rate_limit.unavailable",
    }),
  ]);
  return person.allowed ? network : person;
}

export function mcpUsageKey(date: string): string {
  return `mcp:v1:calls:${date}`;
}

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * A client's self-reported name as a short, safe hash field: lowercase,
 * letters, digits, dots, dashes and underscores only.
 */
export function normalizeClientName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || null;
}

// KEYS[1]: the day's hash; KEYS[2] (optional): the feed notice key.
// ARGV[1]: the hash's lifetime; ARGV[2..]: fields to increment. Returns 1 when
// this is the first notice for KEYS[2] in NOTICE_SECONDS.
const RECORD_SCRIPT = `
for index = 2, #ARGV do
  local field = ARGV[index]
  if string.sub(field, 1, 7) == "client:"
    and redis.call("HEXISTS", KEYS[1], field) == 0
    and redis.call("HLEN", KEYS[1]) >= ${MAX_DAY_FIELDS} then
    field = "client:other"
  end
  redis.call("HINCRBY", KEYS[1], field, 1)
end
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
if KEYS[2] then
  if redis.call("SET", KEYS[2], "1", "NX", "EX", ${NOTICE_SECONDS}) then
    return 1
  end
end
return 0
`;

async function record(fields: string[], noticeKey?: string): Promise<boolean> {
  try {
    const first = await upstashEval<number>({
      script: RECORD_SCRIPT,
      keys: [
        mcpUsageKey(utcDate(Date.now())),
        ...(noticeKey ? [noticeKey] : []),
      ],
      args: [RETENTION_SECONDS, ...fields],
    });
    return first === 1;
  } catch {
    // Counting is telemetry; the call it describes already succeeded.
    return false;
  }
}

/**
 * Counts one tool call (and its outcome, when not a plain hit). Resolves true
 * when the /admin feed should hear about it: the first call from this network
 * for this tool and subject in ten minutes.
 */
export function recordMcpCall(params: {
  tool: McpToolName;
  outcome: McpOutcome;
  clientIp: string | null;
  /** What the call was about (a repository), to group feed notices. */
  subject?: string;
}): Promise<boolean> {
  const fields = [`tool:${params.tool}`];
  if (params.outcome !== "found")
    fields.push(`${params.outcome}:${params.tool}`);
  const noticeKey = params.clientIp
    ? `mcp:v1:notice:${encodeURIComponent(networkOf(params.clientIp))}:${params.tool}:${encodeURIComponent((params.subject ?? "").toLowerCase().slice(0, 140))}`
    : undefined;
  return record(fields, noticeKey);
}

/** Counts one handshake (a new agent session) by the client's name. */
export async function recordMcpConnect(clientName: string): Promise<void> {
  await record([`client:${clientName}`]);
}

export interface McpDayUsage {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  /** Tool calls, all tools. */
  calls: number;
  byTool: Record<string, number>;
  /** Calls that found nothing stored (a demand signal). */
  missing: number;
  limited: number;
  errors: number;
  /** Handshakes by client name. */
  clients: Record<string, number>;
}

const HGETALL_SCRIPT = `
local days = {}
for index = 1, #KEYS do
  days[index] = redis.call("HGETALL", KEYS[index])
end
return days
`;

function toDayUsage(date: string, flat: string[]): McpDayUsage {
  const day: McpDayUsage = {
    date,
    calls: 0,
    byTool: {},
    missing: 0,
    limited: 0,
    errors: 0,
    clients: {},
  };
  for (let index = 0; index + 1 < flat.length; index += 2) {
    const field = flat[index]!;
    const count = Number(flat[index + 1]) || 0;
    const [kind, name = ""] = field.split(/:(.*)/s);
    if (kind === "tool") {
      day.byTool[name] = count;
      day.calls += count;
    } else if (kind === "missing") day.missing += count;
    else if (kind === "limited") day.limited += count;
    else if (kind === "error") day.errors += count;
    else if (kind === "client") day.clients[name] = count;
  }
  return day;
}

/**
 * MCP usage for the last `days` UTC days, today first. Throws when Redis
 * cannot be read.
 */
export async function getMcpUsage(
  days: number,
  now = Date.now(),
): Promise<McpDayUsage[]> {
  const count = Math.min(Math.max(Math.floor(days), 1), 120);
  const dates = Array.from({ length: count }, (_, index) =>
    utcDate(now - index * 24 * 60 * 60 * 1000),
  );
  const result = await upstashEval<string[][]>({
    script: HGETALL_SCRIPT,
    keys: dates.map(mcpUsageKey),
  });
  return dates.map((date, index) => toDayUsage(date, result?.[index] ?? []));
}
