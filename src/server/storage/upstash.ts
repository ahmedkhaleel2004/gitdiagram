import { readRequiredEnv } from "~/server/storage/config";

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
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

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
  return execute<T>("/eval", {
    script: params.script,
    keys: params.keys ?? [],
    args: params.args ?? [],
  });
}
