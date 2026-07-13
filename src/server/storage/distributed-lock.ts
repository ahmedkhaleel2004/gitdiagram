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
  let acquired = false;

  while (!acquired) {
    const result = await upstashCommand<"OK" | null>([
      "SET",
      params.key,
      token,
      "NX",
      "PX",
      ttlMs,
    ]);
    acquired = result === "OK";

    if (!acquired) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for distributed lock: ${params.key}`,
        );
      }
      await sleep(50 + Math.floor(Math.random() * 100));
    }
  }

  try {
    return await params.callback();
  } finally {
    try {
      await upstashEval<number>({
        script: RELEASE_LOCK_SCRIPT,
        keys: [params.key],
        args: [token],
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "storage.distributed_lock.release_failed",
          lock_key: params.key,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  }
}
