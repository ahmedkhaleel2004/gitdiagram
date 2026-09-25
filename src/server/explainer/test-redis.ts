// A real Redis for *.redis.test.ts: REDIS_TEST_URL when set (CI provides
// one), else a throwaway redis-server on a free local port. Commands go
// through the same shapes as upstashCommand and upstashEval, so the code
// under test runs its real Lua scripts.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "redis";

const makeClient = (url: string) => createClient({ url });
type Client = ReturnType<typeof makeClient>;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string")
    throw new Error("Could not allocate a local Redis test port.");
  return address.port;
}

async function connect(url: string, output: () => string): Promise<Client> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = makeClient(url);
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
      output().trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export interface TestRedis {
  command<T>(command: unknown[]): Promise<T>;
  eval<T>(params: {
    script: string;
    keys?: string[];
    args?: Array<string | number>;
  }): Promise<T>;
  /** Delete every key matching the pattern. */
  clear(pattern: string): Promise<void>;
  stop(): Promise<void>;
}

export async function startTestRedis(): Promise<TestRedis> {
  let server: ChildProcess | null = null;
  let output = "";
  let url = process.env.REDIS_TEST_URL?.trim();
  if (!url) {
    const port = await freePort();
    server = spawn(
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
    server.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    server.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    server.once("error", (error) => (output += `\n${error.message}`));
    url = `redis://127.0.0.1:${port}`;
  }
  const client = await connect(url, () => output);
  const send = <T>(command: unknown[]) =>
    client.sendCommand(command.map(String)) as Promise<T>;
  return {
    command: send,
    eval: ({ script, keys = [], args = [] }) =>
      send(["EVAL", script, keys.length, ...keys, ...args]),
    async clear(pattern) {
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [next, found] = await send<[string, string[]]>([
          "SCAN",
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          1000,
        ]);
        cursor = next;
        keys.push(...found);
      } while (cursor !== "0");
      if (keys.length) await send(["DEL", ...keys]);
    },
    async stop() {
      if (client.isOpen) client.destroy();
      if (!server || server.exitCode !== null) return;
      server.kill("SIGTERM");
      await Promise.race([once(server, "exit"), delay(2_000)]);
      if (server.exitCode === null) server.kill("SIGKILL");
    },
  };
}
