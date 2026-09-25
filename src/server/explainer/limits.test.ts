import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { upstashEval, upstashCommand } = vi.hoisted(() => ({
  upstashEval: vi.fn(),
  upstashCommand: vi.fn(),
}));

vi.mock("~/server/storage/upstash", () => ({ upstashEval, upstashCommand }));

import {
  isTrustedVideoCaller,
  isVideoAdmin,
  limitMessage,
  reserveVideoSlot,
  tryVideoLock,
  videosLeftToday,
} from "./limits";

const TOKEN = "t".repeat(40);
const originalEnv = { ...process.env };

const request = (authorization?: string) =>
  new Request("https://gitdiagram.com/api/video/generate", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv, VIDEO_ADMIN_TOKEN: TOKEN };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("explainer video limits", () => {
  it("recognizes the operator token and nothing else", () => {
    expect(isVideoAdmin(request(`Bearer ${TOKEN}`))).toBe(true);
    expect(isVideoAdmin(request(`Bearer ${TOKEN}x`))).toBe(false);
    expect(isVideoAdmin(request(TOKEN))).toBe(false);
    expect(isVideoAdmin(request())).toBe(false);
    process.env.VIDEO_ADMIN_TOKEN = "short";
    expect(isVideoAdmin(request("Bearer short"))).toBe(false);
  });

  it("only trusts the public in local development", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isTrustedVideoCaller(request())).toBe(false);
    expect(isTrustedVideoCaller(request(`Bearer ${TOKEN}`))).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(isTrustedVideoCaller(request())).toBe(true);
    vi.unstubAllEnvs();
  });

  it("reserves against the daily and per-network budgets", async () => {
    process.env.VIDEO_DAILY_LIMIT = "25";
    process.env.VIDEO_IP_DAILY_LIMIT = "2";
    upstashEval.mockResolvedValueOnce(0);
    const granted = await reserveVideoSlot("203.0.113.9");
    expect(granted.ok).toBe(true);
    const call = upstashEval.mock.calls[0]![0] as {
      keys: string[];
      args: number[];
    };
    expect(call.keys[0]).toMatch(/^video:v1:generate:all:\d+$/);
    expect(call.keys[1]).toMatch(/^video:v1:generate:net:203\.0\.113\.9:\d+$/);
    expect(call.args.slice(0, 2)).toEqual([25, 2]);

    upstashEval.mockResolvedValueOnce(1);
    expect(await reserveVideoSlot("203.0.113.9")).toEqual({
      ok: false,
      reason: "daily",
      limit: 25,
    });
    upstashEval.mockResolvedValueOnce(2);
    expect(await reserveVideoSlot(null)).toEqual({
      ok: false,
      reason: "network",
      limit: 2,
    });
    expect(
      (upstashEval.mock.calls[2]![0] as { keys: string[] }).keys[1],
    ).toContain(":net:unknown:");
  });

  it("refunds a slot against the same keys it took", async () => {
    upstashEval.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const granted = await reserveVideoSlot("198.51.100.4");
    if (!granted.ok) throw new Error("expected a slot");
    await granted.refund();
    const [taken, refunded] = upstashEval.mock.calls.map(
      (args) => (args[0] as { keys: string[] }).keys,
    );
    expect(refunded).toEqual(taken);
  });

  it("reports what is left today", async () => {
    process.env.VIDEO_DAILY_LIMIT = "25";
    upstashCommand.mockResolvedValueOnce("24");
    expect(await videosLeftToday()).toBe(1);
    upstashCommand.mockResolvedValueOnce(null);
    expect(await videosLeftToday()).toBe(25);
  });

  it("locks once across instances and releases only its own lock", async () => {
    upstashCommand.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    const release = await tryVideoLock("generate:a/b", 1000);
    expect(release).toBeTypeOf("function");
    expect(await tryVideoLock("generate:a/b", 1000)).toBeNull();
    upstashEval.mockResolvedValueOnce(1);
    await release?.();
    const [set] = upstashCommand.mock.calls[0]!;
    const token = (set as unknown[])[2];
    expect(upstashEval.mock.calls[0]![0]).toMatchObject({
      keys: ["video:v1:lock:generate:a/b"],
      args: [token],
    });
  });

  it("tells people their own limit and when it resets", () => {
    // 17:00 UTC: seven hours until the budgets reset.
    const at = Date.UTC(2026, 8, 24, 17, 0);
    expect(limitMessage("network", 1, at)).toBe(
      "You've already made your free video for today. You can make another in about 7 hours. Every video that's already been made is still free to watch.",
    );
    expect(limitMessage("network", 3, at)).toContain(
      "You've already made your 3 free videos for today.",
    );
    expect(limitMessage("daily", 25, at)).toContain(
      "New ones open up in about 7 hours.",
    );
    expect(limitMessage("network", 1, Date.UTC(2026, 8, 24, 23, 30))).toContain(
      "in under an hour",
    );
    expect(limitMessage("network", 1, at)).not.toMatch(/network/i);
  });
});
