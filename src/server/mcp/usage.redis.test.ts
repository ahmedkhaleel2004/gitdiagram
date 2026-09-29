// @vitest-environment node
// The MCP limiter and usage counts are Lua scripts; these run them against a
// real Redis (see src/server/explainer/test-redis.ts).
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { TestRedis } from "~/server/explainer/test-redis";

const redis = vi.hoisted(() => ({ current: null as TestRedis | null }));

vi.mock("server-only", () => ({}));
vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: (command: unknown[]) => redis.current!.command(command),
  upstashEval: (params: {
    script: string;
    keys?: string[];
    args?: Array<string | number>;
  }) => redis.current!.eval(params),
}));

import { startTestRedis } from "~/server/explainer/test-redis";
import {
  consumeMcpRateLimit,
  getMcpUsage,
  mcpUsageKey,
  recordMcpCall,
  recordMcpConnect,
} from "./usage";

const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  redis.current = await startTestRedis();
});

afterEach(async () => {
  await redis.current!.clear("mcp:v1:*");
  await redis.current!.clear("ratelimit:v2:mcp:*");
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await redis.current?.stop();
});

describe("MCP usage in Redis", () => {
  it("counts calls per tool, outcomes and clients, and reads them back", async () => {
    await recordMcpCall({
      tool: "get_repository_diagram",
      outcome: "found",
      clientIp: "203.0.113.1",
      subject: "fastapi/fastapi",
    });
    await recordMcpCall({
      tool: "get_repository_diagram",
      outcome: "missing",
      clientIp: "203.0.113.1",
      subject: "someone/else",
    });
    await recordMcpCall({
      tool: "find_repository_diagrams",
      outcome: "limited",
      clientIp: "203.0.113.2",
    });
    await recordMcpConnect("claude-code");
    await recordMcpConnect("claude-code");

    const [day] = await getMcpUsage(7);
    expect(day).toEqual({
      date: today(),
      calls: 3,
      byTool: { get_repository_diagram: 2, find_repository_diagrams: 1 },
      missing: 1,
      limited: 1,
      errors: 0,
      clients: { "claude-code": 2 },
    });
    const ttl = await redis.current!.command<number>([
      "TTL",
      mcpUsageKey(today()),
    ]);
    expect(ttl).toBeGreaterThan(119 * 24 * 60 * 60);
  });

  it("returns every requested day, today first, empty when unused", async () => {
    const days = await getMcpUsage(7);
    expect(days).toHaveLength(7);
    expect(days[0]!.date).toBe(today());
    expect(days.every((day) => day.calls === 0)).toBe(true);
  });

  it("notifies the feed once per network, tool and repository in ten minutes", async () => {
    const call = (clientIp: string, subject: string) =>
      recordMcpCall({
        tool: "get_repository_diagram",
        outcome: "found",
        clientIp,
        subject,
      });
    expect(await call("203.0.113.1", "fastapi/fastapi")).toBe(true);
    expect(await call("203.0.113.1", "FastAPI/FastAPI")).toBe(false);
    expect(await call("203.0.113.1", "vercel/next.js")).toBe(true);
    expect(await call("203.0.113.9", "fastapi/fastapi")).toBe(true);
  });

  it("folds client names past the field cap into other", async () => {
    for (let index = 0; index < 205; index += 1)
      await recordMcpConnect(`client-${index}`);
    const [day] = await getMcpUsage(1);
    expect(Object.keys(day!.clients).length).toBeLessThanOrEqual(201);
    expect(day!.clients.other).toBeGreaterThan(0);
  });

  it("limits tool calls per network per window", async () => {
    vi.stubEnv("MCP_RATE_LIMIT_MAX", "3");
    const results = [];
    for (let index = 0; index < 5; index += 1)
      results.push((await consumeMcpRateLimit("2001:db8::1")).allowed);
    // Another address in the same /64 shares the budget.
    results.push((await consumeMcpRateLimit("2001:db8::2")).allowed);
    expect(results).toEqual([true, true, true, false, false, false]);
    expect((await consumeMcpRateLimit("198.51.100.4")).allowed).toBe(true);
  });
});
