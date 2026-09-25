import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { upstashEval, upstashCommand, readAdmissionControls } = vi.hoisted(
  () => ({
    upstashEval: vi.fn(),
    upstashCommand: vi.fn(),
    readAdmissionControls: vi.fn(),
  }),
);

const CONTROLS = {
  videoAudience: "priority",
  videosPaused: false,
  videoDailyLimit: null,
  videoPersonDailyLimit: null,
  videoNetworkDailyLimit: null,
};

vi.mock("~/server/storage/upstash", () => ({ upstashEval, upstashCommand }));
vi.mock("~/server/admin/controls", () => ({
  readAdmissionControls,
  readControls: vi.fn(async () => CONTROLS),
}));

import {
  firstGateNotice,
  generationLockName,
  isTrustedVideoCaller,
  isVideoAdmin,
  isVideoLockHeld,
  limitMessage,
  reserveVideoSlot,
  resetUsageToday,
  tryPaidVideoRun,
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

/** A Redis holding the given epochs (by key) and counters. */
function redis(values: Record<string, string> = {}) {
  upstashCommand.mockImplementation(async (command: unknown[]) => {
    if (command[0] === "MGET")
      return command.slice(1).map((key) => values[String(key)] ?? null);
    if (command[0] === "GET") return values[String(command[1])] ?? null;
    if (command[0] === "INCR") {
      const key = String(command[1]);
      values[key] = String(Number(values[key] ?? "0") + 1);
      return Number(values[key]);
    }
    return null;
  });
  return values;
}

const evalKeys = (call: number) =>
  (upstashEval.mock.calls[call]![0] as { keys: string[] }).keys;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv, VIDEO_ADMIN_TOKEN: TOKEN };
  readAdmissionControls.mockResolvedValue(CONTROLS);
  redis();
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
      args: Array<number | string>;
    };
    // Before any reset (epoch 0) the counters keep their old names.
    expect(call.keys[0]).toMatch(/^video:v1:generate:all:\d+$/);
    expect(call.keys[1]).toMatch(/^video:v1:generate:who:alice:\d+$/);
    expect(call.keys[2]).toMatch(/^video:v1:generate:net:203\.0\.113\.9:\d+$/);
    expect(call.keys[3]).toBe("video:v1:generate:epoch");
    expect(call.args.slice(0, 3)).toEqual([25, 1, 10]);
    expect(call.args[4]).toBe("0");

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
    expect(evalKeys(3)[2]).toContain(":net:unknown:");
  });

  it("refuses to reserve when the live limits cannot be read", async () => {
    readAdmissionControls.mockRejectedValueOnce(new Error("redis down"));
    await expect(
      reserveVideoSlot({ visitorId: "alice", clientIp: null }),
    ).rejects.toThrow("redis down");
    expect(upstashEval).not.toHaveBeenCalled();
  });

  it("counts people who share a connection separately", async () => {
    upstashEval.mockResolvedValue(0);
    await reserveVideoSlot({ visitorId: "alice", clientIp: "203.0.113.9" });
    await reserveVideoSlot({ visitorId: "bob", clientIp: "203.0.113.9" });
    const [alice, bob] = [evalKeys(0), evalKeys(1)];
    expect(alice[1]).not.toBe(bob[1]);
    expect(alice[2]).toBe(bob[2]);
  });

  it("refunds a slot against the same keys it took", async () => {
    upstashEval.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const granted = await reserveVideoSlot({
      visitorId: "carol",
      clientIp: "198.51.100.4",
    });
    if (!granted.ok) throw new Error("expected a slot");
    await granted.refund();
    expect(evalKeys(1)).toEqual(evalKeys(0).slice(0, 3));
  });

  it("counts again when a reset lands mid-reservation", async () => {
    upstashEval.mockResolvedValueOnce(-1).mockResolvedValueOnce(0);
    const granted = await reserveVideoSlot({ visitorId: "d", clientIp: null });
    expect(granted.ok).toBe(true);
    expect(upstashEval).toHaveBeenCalledTimes(2);
  });

  it("reports what is left today", async () => {
    process.env.VIDEO_DAILY_LIMIT = "25";
    const day = Math.floor(Date.now() / 86_400_000);
    redis({ [`video:v1:generate:all:${day}`]: "24" });
    expect(await videosLeftToday()).toBe(1);
    redis();
    expect(await videosLeftToday()).toBe(25);
  });

  it("resets by moving to a new epoch, so old refunds cannot free new slots", async () => {
    const day = Math.floor(Date.now() / 86_400_000);
    const values = redis({ [`video:v1:generate:all:${day}`]: "7" });
    upstashEval.mockResolvedValue(0);
    const before = await reserveVideoSlot({ visitorId: "e", clientIp: null });
    if (!before.ok) throw new Error("expected a slot");

    await expect(resetUsageToday("generate")).resolves.toBe(7);
    expect(values["video:v1:generate:epoch"]).toBe("1");
    // Nothing is deleted: counters that runs in flight hold stay put.
    expect(
      upstashCommand.mock.calls.some(([command]) =>
        ["DEL", "SCAN"].includes(String((command as unknown[])[0])),
      ),
    ).toBe(false);

    const after = await reserveVideoSlot({ visitorId: "e", clientIp: null });
    if (!after.ok) throw new Error("expected a slot");
    const oldKeys = evalKeys(0).slice(0, 3);
    const newKeys = evalKeys(1).slice(0, 3);
    expect(newKeys[0]).toBe(`video:v1:generate:all:${day}:e1`);
    for (const key of newKeys) expect(oldKeys).not.toContain(key);

    // The old run's refund touches only the old epoch's counters.
    await before.refund();
    expect(evalKeys(2)).toEqual(oldKeys);
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

  it("tells whether a repository's generation lock is held", async () => {
    upstashCommand.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const name = generationLockName("Acme", "Demo");
    expect(name).toBe("generate:acme/demo");
    expect(await isVideoLockHeld(name)).toBe(true);
    expect(await isVideoLockHeld(name)).toBe(false);
    expect(upstashCommand).toHaveBeenCalledWith([
      "EXISTS",
      "video:v1:lock:generate:acme/demo",
    ]);
    upstashCommand.mockRejectedValueOnce(new Error("down"));
    expect(await isVideoLockHeld(name)).toBe(false);
  });

  it("caps paid runs at once, but never refuses the operator", async () => {
    upstashEval.mockResolvedValueOnce(0);
    expect(await tryPaidVideoRun({ operator: false, ttlMs: 1000 })).toBeNull();
    upstashEval.mockResolvedValueOnce(1);
    const release = await tryPaidVideoRun({ operator: true, ttlMs: 1000 });
    expect(release).toBeTypeOf("function");
    const args = (upstashEval.mock.calls[1]![0] as { args: unknown[] }).args;
    expect(args[2]).toBe("1");
    await release?.();
    expect(upstashCommand).toHaveBeenCalledWith([
      "ZREM",
      "video:v1:generate:running",
      args[4],
    ]);
  });

  it("reports a held-back visitor once per connection and repository", async () => {
    upstashCommand.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    const notice = { clientIp: "203.0.113.9", repository: "A/B", step: "page" };
    expect(await firstGateNotice(notice)).toBe(true);
    expect(await firstGateNotice(notice)).toBe(false);
    expect(upstashCommand.mock.calls[0]![0]).toEqual([
      "SET",
      "video:v1:gated:page:203.0.113.9:a/b",
      "1",
      "NX",
      "EX",
      600,
    ]);
    upstashCommand.mockRejectedValueOnce(new Error("down"));
    expect(await firstGateNotice(notice)).toBe(false);
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
});
