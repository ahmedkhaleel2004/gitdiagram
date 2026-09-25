// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient } from "redis";

// Runs the claim script on a real Redis (REDIS_TEST_URL in CI, otherwise a
// local redis-server on a free port), through the same keys and arguments
// production sends to Upstash.
const redis = vi.hoisted(() => ({
  client: null as null | {
    eval: (
      script: string,
      options: { keys: string[]; arguments: string[] },
    ) => Promise<unknown>;
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("~/server/storage/upstash", () => ({
  upstashEval: (params: {
    script: string;
    keys?: string[];
    args?: Array<string | number>;
  }) =>
    redis.client!.eval(params.script, {
      keys: params.keys ?? [],
      arguments: (params.args ?? []).map(String),
    }),
  upstashCommand: async () => null,
}));

import { claimSponsorEvent } from "~/server/sponsor-clicks";

const NOW_MS = Date.parse("2026-10-21T12:10:00Z");
const CONNECT_TIMEOUT_MS = 5_000;
const runId = randomUUID();
let campaignId = "";
let redisProcess: ChildProcess | null = null;
let redisProcessOutput = "";
let client: Awaited<ReturnType<typeof connectWithRetry>>;

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a local Redis test port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function startRedisForTests(): Promise<string> {
  const configuredUrl = process.env.REDIS_TEST_URL?.trim();
  if (configuredUrl) return configuredUrl;
  const port = await findAvailablePort();
  redisProcess = spawn(
    "redis-server",
    [
      "--bind",
      "127.0.0.1",
      "--protected-mode",
      "no",
      "--port",
      String(port),
      "--save",
      "",
      "--appendonly",
      "no",
      "--loglevel",
      "warning",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [redisProcess.stdout, redisProcess.stderr])
    stream?.on("data", (chunk: Buffer) => {
      redisProcessOutput += chunk.toString();
    });
  redisProcess.once("error", (error) => {
    redisProcessOutput += `\n${error.message}`;
  });
  return `redis://127.0.0.1:${port}`;
}

async function connectWithRetry(url: string) {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const candidate = createClient({ url });
    candidate.on("error", () => undefined);
    try {
      await candidate.connect();
      return candidate;
    } catch (error) {
      lastError = error;
      candidate.destroy();
      await delay(50);
    }
  }
  throw new Error(
    [
      `Could not connect to the Redis test server at ${url}.`,
      lastError instanceof Error ? lastError.message : String(lastError),
      redisProcessOutput.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function campaignKeys() {
  const keys: string[] = [];
  for await (const batch of client.scanIterator({
    MATCH: `sponsor:v1:*${campaignId}*`,
    COUNT: 1000,
  }))
    keys.push(...batch);
  return keys;
}

function impression(clientIp: string | null, pageViewId = randomUUID()) {
  return claimSponsorEvent(
    {
      event: "sponsor_impression",
      campaignId,
      placement: "home",
      clientIp,
      pageViewId,
    },
    NOW_MS,
  );
}

function click(clientIp: string) {
  return claimSponsorEvent(
    { event: "sponsor_click", campaignId, placement: "readme", clientIp },
    NOW_MS,
  );
}

beforeAll(async () => {
  client = await connectWithRetry(await startRedisForTests());
  redis.client = client as unknown as typeof redis.client;
});

beforeEach(() => {
  campaignId = `test-${runId}-${randomUUID().slice(0, 8)}`;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  const keys = await campaignKeys();
  if (keys.length) await client.del(keys);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (client?.isOpen) client.destroy();
  if (!redisProcess || redisProcess.exitCode !== null) return;
  redisProcess.kill("SIGTERM");
  await Promise.race([once(redisProcess, "exit"), delay(2_000)]);
  if (redisProcess.exitCode === null) redisProcess.kill("SIGKILL");
});

describe("sponsor claim Lua semantics", () => {
  it("caps a network's impressions without storing the page views it rejects", async () => {
    const results: boolean[] = [];
    for (let index = 0; index < 250; index += 1)
      results.push(await impression("192.0.2.10"));
    expect(results.filter(Boolean)).toHaveLength(120);
    // 120 page views, the network's counter and the campaign's counter; the
    // 130 rejected page views leave nothing behind.
    const keys = await campaignKeys();
    expect(keys).toHaveLength(122);
    const cap = keys.find((key) => key.includes(":impression-cap:"))!;
    expect(await client.get(cap)).toBe("120");
    expect(await client.ttl(cap)).toBeGreaterThan(0);
    expect(await client.ttl(cap)).toBeLessThanOrEqual(50 * 60);
  });

  it("counts a page view once and duplicates do not use up the cap", async () => {
    const pageViewId = randomUUID();
    expect(await impression("192.0.2.11", pageViewId)).toBe(true);
    expect(await impression("192.0.2.11", pageViewId)).toBe(false);
    const cap = (await campaignKeys()).find((key) =>
      key.includes(":impression-cap:"),
    )!;
    expect(await client.get(cap)).toBe("1");
    const pageView = (await campaignKeys()).find((key) =>
      key.endsWith(pageViewId),
    )!;
    expect(await client.ttl(pageView)).toBeGreaterThan(24 * 60 * 60 - 5);
  });

  it("drops events past the campaign's hourly ceiling and logs the first one", async () => {
    vi.stubEnv("SPONSOR_IMPRESSIONS_PER_CAMPAIGN_HOUR", "5");
    const results: boolean[] = [];
    for (let index = 0; index < 8; index += 1)
      results.push(await impression(`198.51.100.${index}`));
    expect(results).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    // 5 page views, 5 network counters and the campaign counter.
    expect(await campaignKeys()).toHaveLength(11);
    expect(console.warn).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(console.warn).mock.calls[0]![0])).toMatchObject(
      { event: "sponsor.campaign_ceiling.exceeded", ceiling: 5 },
    );
    // Impressions without a known caller still count toward the ceiling.
    expect(await impression(null)).toBe(false);
  });

  it("counts one click per /48 and window, and caps clicks per campaign", async () => {
    expect(await click("2001:db8:1:aa::1")).toBe(true);
    expect(await click("2001:db8:1:bb:1:2:3:4")).toBe(false);
    expect(await click("2001:db8:2::1")).toBe(true);
    expect(await click("192.0.2.1")).toBe(true);
    expect(await click("192.0.2.1")).toBe(false);

    vi.stubEnv("SPONSOR_CLICKS_PER_CAMPAIGN_HOUR", "3");
    expect(await click("192.0.2.2")).toBe(false);
    // Only the accepted clicks' keys plus the campaign counter exist.
    expect(await campaignKeys()).toHaveLength(4);
  });
});
