import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  isAdminRequest,
  isAdminSession,
  isOperatorToken,
} from "./operator";

const TOKEN = "a".repeat(40);
const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, VIDEO_ADMIN_TOKEN: TOKEN };
});
afterEach(() => {
  process.env = originalEnv;
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

  it("issues sessions that expire and cannot be forged", () => {
    const now = Date.now();
    const session = createAdminSession(now)!;
    expect(isAdminSession(session.value, now)).toBe(true);
    expect(
      isAdminSession(session.value, now + session.maxAgeSeconds * 1000),
    ).toBe(false);
    const [version, expiry, signature] = session.value.split(".");
    expect(
      isAdminSession(`${version}.${Number(expiry) + 1}.${signature}`, now),
    ).toBe(false);
    expect(isAdminSession(`${version}.${expiry}.${signature}x`, now)).toBe(
      false,
    );
    expect(isAdminSession(undefined, now)).toBe(false);
  });

  it("signs every session out when the token rotates", () => {
    const session = createAdminSession()!;
    process.env.VIDEO_ADMIN_TOKEN = "b".repeat(40);
    expect(isAdminSession(session.value)).toBe(false);
  });

  it("reads the session from the request's cookies", () => {
    const session = createAdminSession()!;
    const request = (cookie: string) =>
      new Request("https://gitdiagram.com/api/admin/state", {
        headers: { cookie },
      });
    expect(
      isAdminRequest(
        request(`theme=dark; ${ADMIN_SESSION_COOKIE}=${session.value}`),
      ),
    ).toBe(true);
    expect(isAdminRequest(request(`other=${session.value}`))).toBe(false);
  });
});
