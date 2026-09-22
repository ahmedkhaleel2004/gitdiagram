import {
  assertLiveStorageAllowedForTests,
  readRequiredEnv,
} from "~/server/storage/config";
import { createClient } from "redis";

const UPSTASH_REQUEST_TIMEOUT_MS = 5_000;
let localRedisClient: ReturnType<typeof createClient> | null = null;

async function getLocalRedisClient() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  localRedisClient ??= createClient({
    url,
    socket: { connectTimeout: UPSTASH_REQUEST_TIMEOUT_MS },
  });
  if (!localRedisClient.isOpen) await localRedisClient.connect();
  return localRedisClient;
}

function getBaseUrl() {
  return readRequiredEnv("UPSTASH_REDIS_REST_URL").replace(/\/$/, "");
}

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${readRequiredEnv("UPSTASH_REDIS_REST_TOKEN")}`,
    "Content-Type": "application/json",
  };
}

async function execute<T>(path: string, body: unknown): Promise<T> {
  assertLiveStorageAllowedForTests(
    process.env.REDIS_URL?.trim() ? "Redis" : "Upstash",
  );

  const local = await getLocalRedisClient();
  if (local) {
    return (await local.sendCommand((body as unknown[]).map(String))) as T;
  }

  const timeoutSignal = AbortSignal.timeout(UPSTASH_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: timeoutSignal,
    });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new Error("Upstash request timed out. Please retry.");
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(
      `Upstash request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) {
    throw new Error(`Upstash command failed: ${payload.error}`);
  }

  return payload.result as T;
}

export async function upstashCommand<T>(command: unknown[]): Promise<T> {
  return execute<T>("", command);
}

export async function upstashEval<T>(params: {
  script: string;
  keys?: string[];
  args?: Array<string | number>;
}): Promise<T> {
  const keys = params.keys ?? [];
  const args = params.args ?? [];
  assertLiveStorageAllowedForTests(
    process.env.REDIS_URL?.trim() ? "Redis" : "Upstash",
  );
  const local = await getLocalRedisClient();
  if (local) {
    return (await local.eval(params.script, {
      keys,
      arguments: args.map(String),
    })) as T;
  }
  return execute<T>("", ["EVAL", params.script, keys.length, ...keys, ...args]);
}

export async function checkUpstashConnection(): Promise<void> {
  // PING is exempt from Upstash's command quota and still succeeds when real
  // application reads and writes are blocked. Probe a regular, read-only command.
  const response = await upstashCommand<number>([
    "EXISTS",
    "gitdiagram:readiness",
  ]);
  if (response !== 0 && response !== 1) {
    throw new Error("Upstash did not return a valid readiness response.");
  }
}

export const checkRedisConnection = checkUpstashConnection;
