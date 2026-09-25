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
  resetUsageToday,
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

  it("reserves against the daily, per-person and per-connection budgets", async () => {
    process.env.VIDEO_DAILY_LIMIT = "25";
    process.env.VIDEO_PERSON_DAILY_LIMIT = "1";
    process.env.VIDEO_NETWORK_DAILY_LIMIT = "10";
    const alice = { visitorId: "alice", clientIp: "203.0.113.9" };
    upstashEval.mockResolvedValueOnce(0);
    const granted = await reserveVideoSlot(alice);
    expect(granted.ok).toBe(true);
    const call = upstashEval.mock.calls[0]![0] as {
      keys: string[];
      args: number[];
    };
    expect(call.keys[0]).toMatch(/^video:v1:generate:all:\d+$/);
    expect(call.keys[1]).toMatch(/^video:v1:generate:who:alice:\d+$/);
    expect(call.keys[2]).toMatch(/^video:v1:generate:net:203\.0\.113\.9:\d+$/);
    expect(call.args.slice(0, 3)).toEqual([25, 1, 10]);

    upstashEval.mockResolvedValueOnce(1);
    expect(await reserveVideoSlot(alice)).toEqual({
      ok: false,
      reason: "daily",
      limit: 25,
    });
    upstashEval.mockResolvedValueOnce(2);
    expect(await reserveVideoSlot(alice)).toEqual({
      ok: false,
      reason: "person",
      limit: 1,
    });
    upstashEval.mockResolvedValueOnce(3);
    expect(
      await reserveVideoSlot({ visitorId: "bob", clientIp: null }),
    ).toEqual({
      ok: false,
      reason: "network",
      limit: 10,
    });
    expect(
      (upstashEval.mock.calls[3]![0] as { keys: string[] }).keys[2],
    ).toContain(":net:unknown:");
  });

  it("counts people who share a connection separately", async () => {
    upstashEval.mockResolvedValue(0);
    await reserveVideoSlot({ visitorId: "alice", clientIp: "203.0.113.9" });
    await reserveVideoSlot({ visitorId: "bob", clientIp: "203.0.113.9" });
    const [alice, bob] = upstashEval.mock.calls.map(
      (args) => (args[0] as { keys: string[] }).keys,
    );
    expect(alice![1]).not.toBe(bob![1]);
    expect(alice![2]).toBe(bob![2]);
  });

  it("refunds a slot against the same keys it took", async () => {
    upstashEval.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const granted = await reserveVideoSlot({
      visitorId: "carol",
      clientIp: "198.51.100.4",
    });
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
    expect(limitMessage("person", 1, at)).toBe(
      "You've already made your free video for today. You can make another in about 7 hours. Every video that's already been made is still free to watch.",
    );
    expect(limitMessage("person", 3, at)).toContain(
      "You've already made your 3 free videos for today.",
    );
    expect(limitMessage("daily", 25, at)).toContain(
      "New ones open up in about 7 hours.",
    );
    expect(limitMessage("person", 1, Date.UTC(2026, 8, 24, 23, 30))).toContain(
      "in under an hour",
    );
    expect(limitMessage("person", 1, at)).not.toMatch(/network/i);
    expect(limitMessage("network", 10, at)).not.toMatch(/network/i);
  });

  it("clears today's total and every person's and network's count", async () => {
    const day = Math.floor(Date.now() / 86_400_000);
    upstashCommand.mockImplementation(async (command: unknown[]) => {
      if (command[0] === "SCAN") {
        const pattern = String(command[3]);
        if (pattern.includes(":who:"))
          return command[1] === "0"
            ? ["7", [`video:v1:generate:who:a:${day}`]]
            : ["0", [`video:v1:generate:who:b:${day}`]];
        return ["0", [`video:v1:generate:net:n:${day}`]];
      }
      if (command[0] === "DEL") return command.length - 1;
      return null;
    });
    await expect(resetUsageToday("generate")).resolves.toBe(4);
    const del = upstashCommand.mock.calls.find(([c]) => c[0] === "DEL")![0];
    expect(del).toEqual([
      "DEL",
      `video:v1:generate:all:${day}`,
      `video:v1:generate:who:a:${day}`,
      `video:v1:generate:who:b:${day}`,
      `video:v1:generate:net:n:${day}`,
    ]);
  });
});
