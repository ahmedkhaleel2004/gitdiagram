import "server-only";

import { after } from "next/server";

import type { AgentFetchDay } from "~/features/admin/visibility";
import { upstashPipeline } from "~/server/storage/upstash";

// Counts fetches by search-engine crawlers and AI agents, per UTC day and bot
// family, in one Redis hash a day: `<family>` is the day's total and
// `<family>@<surface>` the part one route saw. Only requests that reach a
// function are counted: pages served from the CDN's cache (ISR) and static
// files never run code, so this undercounts crawls of cached repo pages.

const KEY_PREFIX = "agents:v1:";
const KEEP_SECONDS = 200 * 24 * 60 * 60;

// Most specific first: "ChatGPT-User" and "OAI-SearchBot" before "GPTBot",
// "Googlebot-Image" is Googlebot. Robots.txt-only tokens (Google-Extended,
// Applebot-Extended) never appear in a user agent, so they are not listed.
const FAMILIES: Array<[family: string, pattern: RegExp]> = [
  ["ChatGPT-User", /ChatGPT-User/i],
  ["OAI-SearchBot", /OAI-SearchBot/i],
  ["GPTBot", /GPTBot/i],
  ["Claude-User", /Claude-User/i],
  ["Claude-SearchBot", /Claude-SearchBot/i],
  ["ClaudeBot", /ClaudeBot|anthropic-ai|Claude-Web/i],
  ["Perplexity-User", /Perplexity-User/i],
  ["PerplexityBot", /PerplexityBot/i],
  ["MistralAI-User", /MistralAI-User/i],
  ["DuckAssistBot", /DuckAssistBot/i],
  ["Gemini", /Google-CloudVertexBot|Gemini-Deep-Research|GoogleAgent/i],
  ["GoogleOther", /GoogleOther/i],
  ["Googlebot", /Googlebot|Google-InspectionTool|AdsBot-Google/i],
  ["bingbot", /bingbot|BingPreview|msnbot/i],
  ["Applebot", /Applebot/i],
  ["meta-externalagent", /meta-externalagent|meta-externalfetcher/i],
  ["facebookexternalhit", /facebookexternalhit|facebookcatalog/i],
  ["Amazonbot", /Amazonbot/i],
  ["Bytespider", /Bytespider/i],
  ["CCBot", /CCBot/i],
  ["cohere-ai", /cohere-ai|cohere-training/i],
  ["YouBot", /YouBot/i],
  ["DuckDuckBot", /DuckDuckBot/i],
  ["YandexBot", /YandexBot|YandexAdditional/i],
  ["Baiduspider", /Baiduspider/i],
  ["PetalBot", /PetalBot/i],
  ["Twitterbot", /Twitterbot/i],
  ["LinkedInBot", /LinkedInBot/i],
  ["Slackbot", /Slackbot|Slack-ImgProxy/i],
  ["Discordbot", /Discordbot/i],
];

/** The bot family a user agent belongs to, or null for everyone else. */
export function agentFamily(userAgent: string | null | undefined) {
  if (!userAgent) return null;
  for (const [family, pattern] of FAMILIES)
    if (pattern.test(userAgent)) return family;
  return null;
}

const dayKey = (day: string) => `${KEY_PREFIX}${day}`;

function utcDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Count one fetch by a known bot. Best effort and never slows the response:
 * one pipelined request, handed to after() inside a request, never throwing.
 * `surface` names the route ("llms.txt", "repo-md", "video-file"...).
 */
export function recordAgentFetch(
  userAgent: string | null | undefined,
  surface: string,
): Promise<void> {
  const family = agentFamily(userAgent);
  if (!family) return Promise.resolve();
  const place = surface.replace(/[^a-z0-9_./-]/gi, "").slice(0, 40) || "other";
  const key = dayKey(utcDay(Date.now()));
  const task = upstashPipeline([
    ["HINCRBY", key, family, 1],
    ["HINCRBY", key, `${family}@${place}`, 1],
    ["EXPIRE", key, KEEP_SECONDS],
  ]).then(
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
    dates.map((day) => ["HGETALL", dayKey(day)]),
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
