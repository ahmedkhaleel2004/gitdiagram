// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "redis";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The sign-in guard and the controls write run their real Lua scripts
// against a real Redis: Upstash's REST calls are forwarded to a local
// redis-server (or REDIS_TEST_URL, as in CI).

vi.mock("server-only", () => ({}));

const live = vi.hoisted(() => ({
  client: null as null | {
    sendCommand: (args: string[]) => Promise<unknown>;
    eval: (
      script: string,
      options: { keys: string[]; arguments: string[] },
    ) => Promise<unknown>;
  },
  emitted: [] as Array<{ kind: string; via?: string }>,
}));

vi.mock("~/server/storage/upstash", () => ({
  // node-redis answers HGETALL with an object; Upstash, with the flat list.
  upstashCommand: async (command: unknown[]) => {
    const reply = await live.client!.sendCommand(command.map(String));
    return reply && typeof reply === "object" && !Array.isArray(reply)
      ? Object.entries(reply).flat()
      : reply;
  },
  upstashEval: (params: {
    script: string;
    keys?: string[];
    args?: Array<string | number>;
  }) =>
    live.client!.eval(params.script, {
      keys: params.keys ?? [],
      arguments: (params.args ?? []).map(String),
    }),
}));

vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: async (event: { kind: string; via?: string }) => {
    live.emitted.push(event);
  },
  requestOrigin: () => ({}),
}));

import { writeControls, readControls, DEFAULT_CONTROLS } from "./controls";
import { checkSignIn, verifyOperatorBearer } from "./sign-in-guard";

const CONNECT_TIMEOUT_MS = 5_000;
const TOKEN = "a".repeat(40);
const runId = randomUUID();

let redisProcess: ChildProcess | null = null;
let redisProcessOutput = "";
let redisClient: Awaited<ReturnType<typeof connectWithRetry>>;
let networks = 0;

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
  const collect = (chunk: Buffer) => {
    redisProcessOutput += chunk.toString();
  };
  redisProcess.stdout?.on("data", collect);
  redisProcess.stderr?.on("data", collect);
  redisProcess.once("error", (error) => {
    redisProcessOutput += `\n${error.message}`;
  });
  return `redis://127.0.0.1:${port}`;
}

async function connectWithRetry(url: string) {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = createClient({ url });
    client.on("error", () => undefined);
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      client.destroy();
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

/** A request from a network no other test uses (keys are per network). */
function fromNewNetwork(authorization?: string) {
  networks += 1;
  const ip = `10.${networks}.0.1`;
  return () =>
    new Request("https://gitdiagram.com/api/video/generate", {
      method: "POST",
      headers: {
        "x-forwarded-for": ip,
        ...(authorization ? { authorization } : {}),
      },
    });
}

beforeAll(async () => {
  redisClient = await connectWithRetry(await startRedisForTests());
  live.client = redisClient as unknown as typeof live.client;
  process.env.VIDEO_ADMIN_TOKEN = TOKEN;
});

afterEach(async () => {
  live.emitted.length = 0;
  const keys = await redisClient.keys("admin:v1:sign-in-*");
  if (keys.length) await redisClient.del(keys);
  await redisClient.del("admin:v1:controls");
});

afterAll(async () => {
  delete process.env.VIDEO_ADMIN_TOKEN;
  if (redisClient?.isOpen) redisClient.destroy();
  if (!redisProcess || redisProcess.exitCode !== null) return;
  redisProcess.kill("SIGTERM");
  await Promise.race([once(redisProcess, "exit"), delay(2_000)]);
  if (redisProcess.exitCode === null) redisProcess.kill("SIGKILL");
});

describe(`sign-in guard on real Redis (${runId.slice(0, 8)})`, () => {
  it("lets exactly ten wrong tokens through a parallel burst", async () => {
    const request = fromNewNetwork();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => checkSignIn(request(), false)),
    );
    expect(results.filter((result) => !result.blocked)).toHaveLength(10);
    const blocked = results.filter((result) => result.blocked);
    expect(blocked).toHaveLength(15);
    for (const result of blocked) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
    // One failure announced for the whole burst.
    expect(results.filter((result) => result.announce)).toHaveLength(1);
    // And the right token is refused too, until the window passes.
    expect((await checkSignIn(request(), true)).blocked).toBe(true);
  });

  it("does not count the right token, and keeps the window from growing", async () => {
    const request = fromNewNetwork();
    for (let attempt = 0; attempt < 5; attempt++)
      expect((await checkSignIn(request(), true)).blocked).toBe(false);
    for (let attempt = 0; attempt < 9; attempt++)
      await checkSignIn(request(), false);
    expect((await checkSignIn(request(), true)).blocked).toBe(false);
    const [key] = await redisClient.keys("admin:v1:sign-in-failures:*");
    expect(await redisClient.get(key!)).toBe("9");
    const ttl = await redisClient.ttl(key!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15 * 60);
  });

  it("counts wrong API tokens once per request, and announces them", async () => {
    const wrong = fromNewNetwork(`Bearer ${TOKEN}x`);
    const request = wrong();
    // A route may ask twice about one request: one failure.
    expect(await verifyOperatorBearer(request, `${TOKEN}x`)).toBe(false);
    expect(await verifyOperatorBearer(request, `${TOKEN}x`)).toBe(false);
    const [key] = await redisClient.keys("admin:v1:sign-in-failures:*");
    expect(await redisClient.get(key!)).toBe("1");
    expect(live.emitted).toEqual([
      expect.objectContaining({ kind: "admin.sign_in_failed", via: "bearer" }),
    ]);
    // The right token works, until the network has used up its tries.
    expect(await verifyOperatorBearer(wrong(), TOKEN)).toBe(true);
    for (let attempt = 0; attempt < 10; attempt++)
      await verifyOperatorBearer(wrong(), "guess");
    expect(await verifyOperatorBearer(wrong(), TOKEN)).toBe(false);
  });
});

describe("live controls on real Redis", () => {
  it("sets and clears fields in one write", async () => {
    await writeControls({ videoDailyLimit: 40, videoNetworkDailyLimit: 5 });
    const saved = await writeControls({
      videosPaused: true,
      videoAudience: "desktop",
      videoDailyLimit: null,
    });
    expect(saved).toEqual({
      ...DEFAULT_CONTROLS,
      videosPaused: true,
      videoAudience: "desktop",
      videoNetworkDailyLimit: 5,
    });
    expect(await redisClient.hGetAll("admin:v1:controls")).toEqual({
      videosPaused: "1",
      videoAudience: "desktop",
      videoNetworkDailyLimit: "5",
    });
    // Clearing alone works too.
    await writeControls({ videoNetworkDailyLimit: null });
    expect((await readControls({ fresh: true })).videoNetworkDailyLimit).toBe(
      null,
    );
  });
});
