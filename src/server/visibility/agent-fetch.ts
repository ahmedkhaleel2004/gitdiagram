import "server-only";

import { after } from "next/server";

import type { AgentFetchDay } from "~/features/admin/visibility";
import {
  agentFetchCommands,
  agentFetchKey,
  utcDay,
} from "~/lib/agent-families";
import { upstashPipeline } from "~/server/storage/upstash";

export { agentFamily } from "~/lib/agent-families";

// Counts fetches by search-engine crawlers and AI agents, per UTC day and bot
// family, in one Redis hash a day: `<family>` is the day's total and
// `<family>@<surface>` the part one route saw. src/proxy.ts counts search and
// AI crawlers on every page, cached ones included (its matcher only admits
// their user agents); routes like /api/video/file count their own fetches.

/**
 * Count one fetch by a known bot. Best effort and never slows the response:
 * one pipelined request, handed to after() inside a request, never throwing.
 * `surface` names the route ("llms.txt", "repo-md", "video-file"...).
 */
export function recordAgentFetch(
  userAgent: string | null | undefined,
  surface: string,
): Promise<void> {
  const commands = agentFetchCommands(userAgent, surface);
  if (!commands) return Promise.resolve();
  const task = upstashPipeline(commands).then(
    () => undefined,
    () => undefined,
  );
  try {
    after(task);
  } catch {
    // Outside a request scope: the caller keeps the process alive.
  }
  return task;
}

/** The last `days` UTC days of counts, newest first. */
export async function readAgentFetches(
  days: number,
  now = Date.now(),
): Promise<AgentFetchDay[]> {
  const dates = Array.from({ length: days }, (_, index) =>
    utcDay(now - index * 86_400_000),
  );
  const results = await upstashPipeline(
    dates.map((day) => ["HGETALL", agentFetchKey(day)]),
  );
  return dates.map((date, index) => {
    const flat = (results[index]?.result ?? []) as string[];
    const families: Record<string, number> = {};
    const surfaces: Record<string, number> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const field = flat[i]!;
      const count = Number(flat[i + 1]) || 0;
      if (field.includes("@")) surfaces[field] = count;
      else families[field] = count;
    }
    return { date, families, surfaces };
  });
}
