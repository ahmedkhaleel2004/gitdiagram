// Which search-engine crawler or AI agent a user agent belongs to, and the
// Redis commands that count one of its fetches. Plain code with no imports,
// shared by the server (src/server/visibility/agent-fetch.ts) and the
// Cloudflare Worker entry, which counts fetches of cached pages itself.

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

/** The Redis hash holding one UTC day's counts ("2026-10-02"). */
export const agentFetchKey = (day: string) => `${KEY_PREFIX}${day}`;

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The pipeline that counts one fetch by a known bot, or null for everyone
 * else. `surface` names the route ("llms.txt", "repo-md", "video-file"...).
 */
export function agentFetchCommands(
  userAgent: string | null | undefined,
  surface: string,
  now = Date.now(),
): Array<Array<string | number>> | null {
  const family = agentFamily(userAgent);
  if (!family) return null;
  const place = surface.replace(/[^a-z0-9_./-]/gi, "").slice(0, 40) || "other";
  const key = agentFetchKey(utcDay(now));
  return [
    ["HINCRBY", key, family, 1],
    ["HINCRBY", key, `${family}@${place}`, 1],
    ["EXPIRE", key, KEEP_SECONDS],
  ];
}
