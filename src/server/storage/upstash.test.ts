import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as StorageConfig from "~/server/storage/config";

vi.mock("~/server/storage/config", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageConfig>()),
  assertLiveStorageAllowedForTests: vi.fn(),
}));

import { checkUpstashConnection } from "~/server/storage/upstash";

const fetchMock = vi.fn<typeof fetch>();

describe("Upstash readiness", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([0, 1])(
    "accepts readable storage with probe result %i",
    async (result) => {
      fetchMock.mockResolvedValue(Response.json({ result }));

      await expect(checkUpstashConnection()).resolves.toBeUndefined();
    },
  );

  it("fails when the monthly quota blocks data commands but PING still works", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      const [command] = JSON.parse(String(init?.body)) as string[];
      return command === "PING"
        ? Response.json({ result: "PONG" })
        : Response.json(
            {
              error:
                "ERR max requests limit exceeded. Limit: 500000, Usage: 500001.",
            },
            { status: 400 },
          );
    });

    await expect(checkUpstashConnection()).rejects.toThrow(
      "max requests limit exceeded",
    );
  });

  it("rejects an invalid probe response", async () => {
    fetchMock.mockResolvedValue(Response.json({ result: "PONG" }));

    await expect(checkUpstashConnection()).rejects.toThrow(
      "valid readiness response",
    );
  });
});
