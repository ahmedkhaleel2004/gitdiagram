import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const redis = vi.hoisted(() => ({
  upstashEval: vi.fn<(params: unknown) => Promise<unknown>>(),
}));
vi.mock("~/server/storage/upstash", () => redis);

import { POST } from "./route";

const SECRET = "p".repeat(40);
const originalEnv = process.env;

const call = (authorization?: string) =>
  POST(
    new Request("https://gitdiagram.com/api/admin/presence-feed", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  process.env = { ...originalEnv, PRESENCE_SECRET: SECRET };
  redis.upstashEval.mockReset();
});
afterEach(() => {
  process.env = originalEnv;
});

describe("the presence worker's feed drain", () => {
  it("answers only the worker", async () => {
    expect((await call()).status).toBe(403);
    expect((await call("Bearer nope")).status).toBe(403);
    expect(redis.upstashEval).not.toHaveBeenCalled();
  });

  it("hands over the parked events, uncached", async () => {
    redis.upstashEval.mockResolvedValue([JSON.stringify({ kind: "a", at: 1 })]);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ events: [{ kind: "a", at: 1 }] });
  });

  it("says so when Redis cannot be read", async () => {
    redis.upstashEval.mockRejectedValue(new Error("down"));
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });
});
