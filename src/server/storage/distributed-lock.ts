import { randomUUID } from "node:crypto";

import { upstashCommand, upstashEval } from "~/server/storage/upstash";

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Takes the lock if it is free; true when this token now holds it. */
async function acquire(key: string, token: string, ttlMs: number) {
  const result = await upstashCommand<"OK" | null>([
    "SET",
    key,
    token,
    "NX",
    "PX",
    ttlMs,
  ]);
  return result === "OK";
}

/**
 * Deletes the lock only while this token still holds it, so a holder whose
 * lock expired never frees the next holder's. Never throws: a lock that is
 * not released expires on its own.
 */
async function release(key: string, token: string, failureEvent: string) {
  try {
    await upstashEval<number>({
      script: RELEASE_LOCK_SCRIPT,
      keys: [key],
      args: [token],
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: failureEvent,
        lock_key: key,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
}

/**
 * One holder at a time across every server instance, without waiting: a
 * release function when the lock was free, else null. The lock expires on
 * its own after ttlMs if the holder dies. Throws when Redis fails.
 */
export async function tryDistributedLock(params: {
  key: string;
  ttlMs: number;
  /** Logged when releasing fails. */
  releaseFailureEvent?: string;
}): Promise<(() => Promise<void>) | null> {
  const token = randomUUID();
  if (!(await acquire(params.key, token, params.ttlMs))) return null;
  return () =>
    release(
      params.key,
      token,
      params.releaseFailureEvent ?? "storage.distributed_lock.release_failed",
    );
}

export async function withDistributedLock<T>(params: {
  key: string;
  callback: () => Promise<T>;
  ttlMs?: number;
  waitMs?: number;
}): Promise<T> {
  const token = randomUUID();
  const ttlMs = params.ttlMs ?? 30_000;
  const waitMs = params.waitMs ?? 10_000;
  const deadline = Date.now() + waitMs;

  while (!(await acquire(params.key, token, ttlMs))) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for distributed lock: ${params.key}`);
    }
    await sleep(50 + Math.floor(Math.random() * 100));
  }

  try {
    return await params.callback();
  } finally {
    await release(params.key, token, "storage.distributed_lock.release_failed");
  }
}
