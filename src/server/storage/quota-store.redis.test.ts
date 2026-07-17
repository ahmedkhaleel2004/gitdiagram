// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "redis";

import {
  buildQuotaKey,
  QUOTA_CHECK_SCRIPT,
  QUOTA_FINALIZE_SCRIPT,
} from "~/server/storage/quota-store";

const SCRIPT_TTL_SECONDS = 3 * 24 * 60 * 60;
const CONNECT_TIMEOUT_MS = 5_000;
const runId = randomUUID();

let redisProcess: ChildProcess | null = null;
let redisProcessOutput = "";
let testKeys: string[] = [];

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
      `Could not connect to the Redis semantic-test server at ${url}.`,
      lastError instanceof Error ? lastError.message : String(lastError),
      redisProcessOutput.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

let redisClient: Awaited<ReturnType<typeof connectWithRetry>>;

async function startRedisForTests(): Promise<string> {
  const configuredUrl = process.env.REDIS_TEST_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

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
  redisProcess.stdout?.on("data", (chunk: Buffer) => {
    redisProcessOutput += chunk.toString();
  });
  redisProcess.stderr?.on("data", (chunk: Buffer) => {
    redisProcessOutput += chunk.toString();
  });
  redisProcess.once("error", (error) => {
    redisProcessOutput += `\n${error.message}`;
  });

  return `redis://127.0.0.1:${port}`;
}

function quotaKey(label: string): string {
  const key = buildQuotaKey("2026-03-30", `${runId}-${label}`);
  testKeys.push(key);
  return key;
}

async function checkQuota(params: {
  key: string;
  reservationId: string;
  requestedTokens: number;
  tokenLimit?: number;
}): Promise<[number, number]> {
  const result = await redisClient.eval(QUOTA_CHECK_SCRIPT, {
    keys: [params.key],
    arguments: [
      String(params.tokenLimit ?? 1_000),
      String(params.requestedTokens),
      String(SCRIPT_TTL_SECONDS),
      params.reservationId,
    ],
  });
  expect(result).toBeInstanceOf(Array);
  return result as [number, number];
}

async function finalizeQuota(params: {
  key: string;
  reservationId: string;
  committedTokens: number;
}): Promise<number> {
  const result = await redisClient.eval(QUOTA_FINALIZE_SCRIPT, {
    keys: [params.key],
    arguments: [
      String(params.committedTokens),
      String(SCRIPT_TTL_SECONDS),
      params.reservationId,
    ],
  });
  expect(typeof result).toBe("number");
  return result as number;
}

beforeAll(async () => {
  const redisUrl = await startRedisForTests();
  redisClient = await connectWithRetry(redisUrl);
});

afterEach(async () => {
  if (testKeys.length) {
    await redisClient.del(testKeys);
    testKeys = [];
  }
});

afterAll(async () => {
  if (redisClient?.isOpen) {
    redisClient.destroy();
  }
  if (!redisProcess || redisProcess.exitCode !== null) {
    return;
  }

  redisProcess.kill("SIGTERM");
  await Promise.race([once(redisProcess, "exit"), delay(2_000)]);
  if (redisProcess.exitCode === null) {
    redisProcess.kill("SIGKILL");
  }
});

describe("quota Lua semantics", () => {
  it("keeps duplicate admission for one reservation id idempotent", async () => {
    const key = quotaKey("duplicate-admission");

    await expect(
      checkQuota({
        key,
        reservationId: "reservation-a",
        requestedTokens: 600,
      }),
    ).resolves.toEqual([1, 0]);
    await expect(
      checkQuota({
        key,
        reservationId: "reservation-a",
        requestedTokens: 600,
      }),
    ).resolves.toEqual([1, 0]);
    await expect(
      checkQuota({
        key,
        reservationId: "reservation-b",
        requestedTokens: 500,
      }),
    ).resolves.toEqual([0, 0]);

    await expect(redisClient.hGetAll(key)).resolves.toEqual({
      "reservation:reservation-a": "600",
      reserved_tokens: "600",
    });
  });

  it("admits only one concurrent reservation when both cannot fit", async () => {
    const key = quotaKey("concurrent-admission");

    const results = await Promise.all([
      checkQuota({
        key,
        reservationId: "reservation-a",
        requestedTokens: 600,
      }),
      checkQuota({
        key,
        reservationId: "reservation-b",
        requestedTokens: 600,
      }),
    ]);

    expect(results.map(([admitted]) => admitted).sort()).toEqual([0, 1]);
    const state = await redisClient.hGetAll(key);
    expect(state.reserved_tokens).toBe("600");
    expect(
      ["reservation:reservation-a", "reservation:reservation-b"].filter(
        (field) => state[field] === "600",
      ),
    ).toHaveLength(1);
  });

  it("does not mutate usage for an unknown id or a mismatched quota key", async () => {
    const key = quotaKey("known-reservation");
    const mismatchedKey = quotaKey("mismatched-reservation");
    await checkQuota({
      key,
      reservationId: "reservation-a",
      requestedTokens: 600,
    });

    await expect(
      finalizeQuota({
        key,
        reservationId: "reservation-b",
        committedTokens: 400,
      }),
    ).resolves.toBe(0);
    await expect(
      finalizeQuota({
        key: mismatchedKey,
        reservationId: "reservation-a",
        committedTokens: 400,
      }),
    ).resolves.toBe(0);

    await expect(redisClient.hGetAll(key)).resolves.toEqual({
      "reservation:reservation-a": "600",
      reserved_tokens: "600",
    });
    await expect(redisClient.exists(mismatchedKey)).resolves.toBe(0);
  });

  it("charges an ambiguous finalization only once across duplicate retries", async () => {
    const key = quotaKey("duplicate-finalization");
    await checkQuota({
      key,
      reservationId: "reservation-a",
      requestedTokens: 600,
    });

    // Treat the first response as lost, then issue the same logical operation
    // again. The persisted finalized marker must make the retry a read-only hit.
    await finalizeQuota({
      key,
      reservationId: "reservation-a",
      committedTokens: 450,
    });
    await expect(
      finalizeQuota({
        key,
        reservationId: "reservation-a",
        committedTokens: 450,
      }),
    ).resolves.toBe(450);
    await expect(
      finalizeQuota({
        key,
        reservationId: "reservation-a",
        committedTokens: 999,
      }),
    ).resolves.toBe(450);

    await expect(redisClient.hGetAll(key)).resolves.toEqual({
      "finalized:reservation-a": "450",
      used_tokens: "450",
    });
  });
});
