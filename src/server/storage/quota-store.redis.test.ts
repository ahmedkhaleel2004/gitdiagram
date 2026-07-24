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
  buildQuotaLeaseKey,
  QUOTA_CHECK_SCRIPT,
  QUOTA_FINALIZE_SCRIPT,
  QUOTA_RESERVATION_LEASE_MS,
} from "~/server/storage/quota-store";

const SCRIPT_TTL_SECONDS = 3 * 24 * 60 * 60;
const NOW_MS = 1_774_000_000_000;
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
  const bucket = `${runId}-${label}`;
  const key = buildQuotaKey("2026-03-30", bucket);
  testKeys.push(key, buildQuotaLeaseKey("2026-03-30", bucket));
  return key;
}

function leaseKeyFor(key: string): string {
  return `${key}:leases`;
}

async function checkQuota(params: {
  key: string;
  reservationId: string;
  requestedTokens: number;
  tokenLimit?: number;
  nowMs?: number;
}): Promise<[number, number]> {
  const result = await redisClient.eval(QUOTA_CHECK_SCRIPT, {
    keys: [params.key, leaseKeyFor(params.key)],
    arguments: [
      String(params.tokenLimit ?? 1_000),
      String(params.requestedTokens),
      String(SCRIPT_TTL_SECONDS),
      params.reservationId,
      String(params.nowMs ?? NOW_MS),
      String(QUOTA_RESERVATION_LEASE_MS),
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
    keys: [params.key, leaseKeyFor(params.key)],
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

  it("reclaims budget from a lease whose generation died before finalizing", async () => {
    const key = quotaKey("expired-lease");

    // A generation is admitted and then the process disappears: nothing ever
    // finalizes this reservation.
    await expect(
      checkQuota({ key, reservationId: "dead-a", requestedTokens: 900 }),
    ).resolves.toEqual([1, 0]);
    await expect(
      checkQuota({ key, reservationId: "live-b", requestedTokens: 900 }),
    ).resolves.toEqual([0, 0]);

    // Once the lease deadline passes, the next admission reclaims the budget
    // instead of leaving it stranded for the rest of the UTC day.
    await expect(
      checkQuota({
        key,
        reservationId: "live-b",
        requestedTokens: 900,
        nowMs: NOW_MS + QUOTA_RESERVATION_LEASE_MS + 1,
      }),
    ).resolves.toEqual([1, 0]);

    const state = await redisClient.hGetAll(key);
    expect(state["reservation:dead-a"]).toBeUndefined();
    expect(state["reclaimed:dead-a"]).toBe("900");
    expect(state.reserved_tokens).toBe("900");
    await expect(redisClient.zScore(leaseKeyFor(key), "dead-a")).resolves.toBe(
      null,
    );
  });

  it("still charges real usage when a late finalize follows a reclaim", async () => {
    const key = quotaKey("late-finalize");

    await checkQuota({ key, reservationId: "slow-a", requestedTokens: 900 });
    await checkQuota({
      key,
      reservationId: "sweeper-b",
      requestedTokens: 50,
      nowMs: NOW_MS + QUOTA_RESERVATION_LEASE_MS + 1,
    });

    // The reclaim gave the reservation back, but the tokens were really spent,
    // so a late finalize must still move the daily counter exactly once.
    await expect(
      finalizeQuota({ key, reservationId: "slow-a", committedTokens: 700 }),
    ).resolves.toBe(700);
    await expect(
      finalizeQuota({ key, reservationId: "slow-a", committedTokens: 700 }),
    ).resolves.toBe(700);

    const state = await redisClient.hGetAll(key);
    expect(state.used_tokens).toBe("700");
    expect(state["reclaimed:slow-a"]).toBeUndefined();
    // Only the sweeper's own lease is still outstanding.
    expect(state.reserved_tokens).toBe("50");
  });

  it("keeps a renewed lease from being reclaimed by a later sweep", async () => {
    const key = quotaKey("renewed-lease");

    await checkQuota({ key, reservationId: "retry-a", requestedTokens: 600 });
    // A duplicate admission for the same id renews the lease rather than
    // double-charging, so the reservation survives a later sweep.
    await checkQuota({
      key,
      reservationId: "retry-a",
      requestedTokens: 600,
      nowMs: NOW_MS + QUOTA_RESERVATION_LEASE_MS - 1,
    });
    await checkQuota({
      key,
      reservationId: "sweeper-b",
      requestedTokens: 100,
      nowMs: NOW_MS + QUOTA_RESERVATION_LEASE_MS + 1,
    });

    const state = await redisClient.hGetAll(key);
    expect(state["reservation:retry-a"]).toBe("600");
    expect(state["reclaimed:retry-a"]).toBeUndefined();
    expect(state.reserved_tokens).toBe("700");
  });
});
