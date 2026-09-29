import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("outside a request");
  },
}));

const { upstashPipeline } = vi.hoisted(() => ({ upstashPipeline: vi.fn() }));
vi.mock("~/server/storage/upstash", () => ({ upstashPipeline }));

import { agentFamily, readAgentFetches, recordAgentFetch } from "./agent-fetch";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("crawler and AI agent counts", () => {
  it.each([
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
      "ChatGPT-User",
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
      "OAI-SearchBot",
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
      "GPTBot",
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "ClaudeBot",
    ],
    ["Claude-User/1.0 (+https://anthropic.com)", "Claude-User"],
    ["Claude-SearchBot/1.0", "Claude-SearchBot"],
    [
      "Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
      "Perplexity-User",
    ],
    [
      "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "PerplexityBot",
    ],
    [
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Googlebot",
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0 Safari/537.36",
      "bingbot",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
      "Applebot",
    ],
    [
      "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
      "meta-externalagent",
    ],
  ])("knows %s", (agent, family) => {
    expect(agentFamily(agent)).toBe(family);
  });

  it("ignores people's browsers", () => {
    expect(
      agentFamily(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBeNull();
    expect(agentFamily(null)).toBeNull();
  });

  it("counts a bot's fetch in one pipelined request, by family and surface", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-29T12:00:00Z") });
    upstashPipeline.mockResolvedValue([]);
    await recordAgentFetch("GPTBot/1.2", "llms.txt");
    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    expect(upstashPipeline).toHaveBeenCalledWith([
      ["HINCRBY", "agents:v1:2026-09-29", "GPTBot", 1],
      ["HINCRBY", "agents:v1:2026-09-29", "GPTBot@llms.txt", 1],
      ["EXPIRE", "agents:v1:2026-09-29", 200 * 86_400],
    ]);
  });

  it("does nothing for people and never throws when Redis fails", async () => {
    await recordAgentFetch("Mozilla/5.0 Safari", "llms.txt");
    expect(upstashPipeline).not.toHaveBeenCalled();
    upstashPipeline.mockRejectedValue(new Error("down"));
    await expect(
      recordAgentFetch("ClaudeBot/1.0", "repo md!"),
    ).resolves.toBeUndefined();
    expect(upstashPipeline.mock.calls[0]![0][1]).toEqual([
      "HINCRBY",
      expect.any(String),
      "ClaudeBot@repomd",
      1,
    ]);
  });

  it("reads each day's counts, newest first", async () => {
    upstashPipeline.mockResolvedValue([
      { result: ["GPTBot", "3", "GPTBot@llms.txt", "2"] },
      { result: [] },
    ]);
    await expect(
      readAgentFetches(2, Date.parse("2026-09-29T01:00:00Z")),
    ).resolves.toEqual([
      {
        date: "2026-09-29",
        families: { GPTBot: 3 },
        surfaces: { "GPTBot@llms.txt": 2 },
      },
      { date: "2026-09-28", families: {}, surfaces: {} },
    ]);
  });
});
