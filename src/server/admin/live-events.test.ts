import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("Outside a request");
  },
}));
const redis = vi.hoisted(() => ({
  upstashEval: vi.fn<(params: unknown) => Promise<unknown>>(),
}));
vi.mock("~/server/storage/upstash", () => redis);

import {
  DASHBOARD_TOKEN_MS,
  tokenExpiry,
} from "~/features/admin/presence-protocol";
import {
  createPresenceToken,
  drainParkedEvents,
  emitLiveEvent,
  isPresenceWorker,
  liveJobId,
} from "./live-events";

const SECRET = "p".repeat(40);
const originalEnv = process.env;

beforeEach(() => {
  // A dashboard is watching: events go straight to the worker.
  redis.upstashEval.mockReset().mockResolvedValue(1);
  process.env = {
    ...originalEnv,
    PRESENCE_SECRET: SECRET,
    NEXT_PUBLIC_PRESENCE_URL: "wss://presence.example.dev/",
  };
});
afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe("dashboard tokens", () => {
  it("mints the `<expiry>.<hmac>` tokens the worker checks", () => {
    const now = 1_800_000_000_000;
    const token = createPresenceToken(now)!;
    expect(tokenExpiry(token)).toBe(now + DASHBOARD_TOKEN_MS);
    const [expiry, signature] = token.split(".");
    expect(signature).toBe(
      createHmac("sha256", SECRET)
        .update(`presence-admin:${expiry}`)
        .digest("hex"),
    );
  });

  it("mints nothing without a long enough secret", () => {
    process.env.PRESENCE_SECRET = "short";
    expect(createPresenceToken()).toBeNull();
  });
});

describe("job ids", () => {
  it("hashes long ids instead of cutting them, so similar jobs stay apart", () => {
    const repo = `acme/${"x".repeat(110)}`;
    const landscape = liveJobId(`render:${repo}:landscape:1`);
    const vertical = liveJobId(`render:${repo}:vertical:1`);
    expect(landscape).not.toBe(vertical);
    expect(landscape).toMatch(/^sha256:[0-9a-f]{40}$/);
    expect(liveJobId("video:acme/app:1")).toBe("video:acme/app:1");
  });

  it("sends the same id for a job's start and end", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    const id = `render:acme/${"y".repeat(130)}:vertical:1`;
    await emitLiveEvent({
      kind: "render.started",
      job: { id, state: "start" },
    });
    await emitLiveEvent({ kind: "render.finished", job: { id, state: "end" } });
    const sent = fetch.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)) as { job: { id: string } },
    );
    expect(fetch.mock.calls[0]?.[0]).toBe("https://presence.example.dev/event");
    expect(sent[0]?.job.id).toBe(liveJobId(id));
    expect(sent[1]?.job.id).toBe(sent[0]?.job.id);
  });
});

describe("sending events", () => {
  it("lets go of the answer's body, and logs a refusal", async () => {
    const response = new Response("nope", { status: 401 });
    const cancel = vi.spyOn(response.body!, "cancel");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      emitLiveEvent({ kind: "video.started" }),
    ).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: "admin.live_event.rejected",
      kind: "video.started",
      status: 401,
    });
  });

  it("never fails the request it describes", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(
      emitLiveEvent({ kind: "video.started" }),
    ).resolves.toBeUndefined();
  });
});

describe("while no dashboard is watching", () => {
  it("parks events in Redis, stamped with their own time, instead of sending them", async () => {
    redis.upstashEval.mockResolvedValue(0);
    const fetch = vi.spyOn(globalThis, "fetch");
    const before = Date.now();
    await emitLiveEvent({ kind: "diagram.started", repo: "acme/app" });
    expect(fetch).not.toHaveBeenCalled();
    const { keys, args } = redis.upstashEval.mock.calls[0]![0] as {
      keys: string[];
      args: [string, number, number];
    };
    expect(keys).toEqual(["admin:v1:feed:watching", "admin:v1:feed:parked"]);
    const parked = JSON.parse(args[0]) as { kind: string; at: number };
    expect(parked.kind).toBe("diagram.started");
    expect(parked.at).toBeGreaterThanOrEqual(before);
    expect(args[1]).toBe(200);
  });

  it("sends straight away when Redis cannot be reached", async () => {
    redis.upstashEval.mockRejectedValue(new Error("down"));
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    await emitLiveEvent({ kind: "video.started" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hands the worker what was parked, oldest first, skipping anything broken", async () => {
    redis.upstashEval.mockResolvedValue([
      JSON.stringify({ kind: "a", at: 1 }),
      "not json",
      "[1]",
      JSON.stringify({ kind: "b", at: 2 }),
    ]);
    expect(await drainParkedEvents()).toEqual([
      { kind: "a", at: 1 },
      { kind: "b", at: 2 },
    ]);
    redis.upstashEval.mockResolvedValue(null);
    expect(await drainParkedEvents()).toEqual([]);
  });

  it("knows the worker by its shared secret", () => {
    const from = (authorization?: string) =>
      new Request("https://gitdiagram.com/api/admin/presence-feed", {
        method: "POST",
        headers: authorization ? { authorization } : {},
      });
    expect(isPresenceWorker(from(`Bearer ${SECRET}`))).toBe(true);
    expect(isPresenceWorker(from(`Bearer ${SECRET}x`))).toBe(false);
    expect(isPresenceWorker(from())).toBe(false);
    process.env.PRESENCE_SECRET = "short";
    expect(isPresenceWorker(from("Bearer short"))).toBe(false);
  });
});
