import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const redis = vi.hoisted(() => ({
  generation: 0 as number | null,
  down: false,
}));

vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: vi.fn(async (command: unknown[]) => {
    if (redis.down) throw new Error("Upstash request timed out.");
    if (command[0] === "GET")
      return redis.generation === null ? null : String(redis.generation);
    if (command[0] === "INCR") {
      redis.generation = (redis.generation ?? 0) + 1;
      return redis.generation;
    }
    throw new Error(`Unexpected ${String(command[0])}`);
  }),
}));

import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  isAdminSession,
  isOperatorConfigured,
  isOperatorToken,
  resetOperatorSessionsForTests,
  revokeAdminSessions,
  verifyAdminRequest,
  verifyAdminSession,
} from "./operator";

const TOKEN = "a".repeat(40);
const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, VIDEO_ADMIN_TOKEN: TOKEN };
  redis.generation = null;
  redis.down = false;
  resetOperatorSessionsForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

const request = (cookie: string) =>
  new Request("https://gitdiagram.com/api/admin/state", {
    headers: { cookie },
  });

describe("operator sign-in", () => {
  it("accepts only the operator token", () => {
    expect(isOperatorToken(TOKEN)).toBe(true);
    expect(isOperatorToken(` ${TOKEN} `)).toBe(true);
    expect(isOperatorToken(`${TOKEN}x`)).toBe(false);
    expect(isOperatorToken("")).toBe(false);
    process.env.VIDEO_ADMIN_TOKEN = "short";
    expect(isOperatorToken("short")).toBe(false);
  });

  it("knows when the dashboard is not set up", () => {
    expect(isOperatorConfigured()).toBe(true);
    process.env.VIDEO_ADMIN_TOKEN = "too short to be safe";
    expect(isOperatorConfigured()).toBe(false);
    delete process.env.VIDEO_ADMIN_TOKEN;
    expect(isOperatorConfigured()).toBe(false);
  });

  it("issues sessions that expire and cannot be forged", async () => {
    const now = Date.now();
    const session = (await createAdminSession(now))!;
    expect(isAdminSession(session.value, now)).toBe(true);
    expect(
      isAdminSession(session.value, now + session.maxAgeSeconds * 1000),
    ).toBe(false);
    const [version, expiry, generation, signature] = session.value.split(".");
    expect(version).toBe("v2");
    expect(
      isAdminSession(
        `${version}.${Number(expiry) + 1}.${generation}.${signature}`,
        now,
      ),
    ).toBe(false);
    expect(
      isAdminSession(`${version}.${expiry}.${generation}.${signature}x`, now),
    ).toBe(false);
    // The generation is signed too.
    expect(
      isAdminSession(`${version}.${expiry}.7.${signature}`, now, null),
    ).toBe(false);
    expect(isAdminSession(undefined, now)).toBe(false);
  });

  it("signs every session out when the token rotates", async () => {
    const session = (await createAdminSession())!;
    process.env.VIDEO_ADMIN_TOKEN = "b".repeat(40);
    expect(await verifyAdminSession(session.value)).toBe(false);
  });

  it("reads the session from the request's cookies", async () => {
    const session = (await createAdminSession())!;
    expect(
      await verifyAdminRequest(
        request(`theme=dark; ${ADMIN_SESSION_COOKIE}=${session.value}`),
      ),
    ).toBe(true);
    expect(await verifyAdminRequest(request(`other=${session.value}`))).toBe(
      false,
    );
    expect(await verifyAdminRequest(request(""))).toBe(false);
  });
});

describe("signing out everywhere", () => {
  it("ends every earlier session, and new ones still work", async () => {
    const before = (await createAdminSession())!;
    expect(await verifyAdminSession(before.value)).toBe(true);
    await revokeAdminSessions();
    expect(await verifyAdminSession(before.value)).toBe(false);
    expect(
      await verifyAdminRequest(
        request(`${ADMIN_SESSION_COOKIE}=${before.value}`),
      ),
    ).toBe(false);
    const after = (await createAdminSession())!;
    expect(await verifyAdminSession(after.value)).toBe(true);
  });

  it("reaches other instances once their cached generation is a few seconds old", async () => {
    const now = Date.now();
    const session = (await createAdminSession(now))!;
    expect(await verifyAdminSession(session.value, now)).toBe(true);
    redis.generation = 3; // another instance signed out everywhere
    expect(await verifyAdminSession(session.value, now + 1_000)).toBe(true);
    expect(await verifyAdminSession(session.value, now + 6_000)).toBe(false);
  });

  it("keeps cookies from before generations working until the first sign-out everywhere", async () => {
    const now = Date.now();
    const expires = now + 86_400_000;
    const legacy = `v1.${expires}.${createHmac("sha256", TOKEN)
      .update(`admin-session:v1:${expires}`)
      .digest("base64url")}`;
    expect(await verifyAdminSession(legacy, now)).toBe(true);
    await revokeAdminSessions();
    expect(await verifyAdminSession(legacy, now)).toBe(false);
  });

  it("accepts a correctly signed session while Redis is down, using what it last knew", async () => {
    redis.down = true;
    const session = (await createAdminSession())!;
    expect(await verifyAdminSession(session.value)).toBe(true);
    await expect(revokeAdminSessions()).rejects.toThrow();

    // Known generation 1, then Redis goes down: generation 0 stays revoked.
    redis.down = false;
    resetOperatorSessionsForTests();
    redis.generation = 1;
    const now = Date.now();
    expect(await verifyAdminSession(session.value, now)).toBe(false);
    redis.down = true;
    expect(await verifyAdminSession(session.value, now + 10_000)).toBe(false);
  });
});
