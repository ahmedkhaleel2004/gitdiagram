// @vitest-environment node
// The video budget, locks and gallery index run as Lua scripts in Redis; the
// unit tests only mock them. These run the real scripts against a real Redis
// (see test-redis.ts). One file, so its tests never race each other's keys.
import { setTimeout as delay } from "node:timers/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { TestRedis } from "./test-redis";

const redis = vi.hoisted(() => ({ current: null as TestRedis | null }));

vi.mock("server-only", () => ({}));
vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: (command: unknown[]) => redis.current!.command(command),
  upstashEval: (params: {
    script: string;
    keys?: string[];
    args?: Array<string | number>;
  }) => redis.current!.eval(params),
}));
vi.mock("~/server/admin/controls", () => {
  const controls = async () => ({
    videoDailyLimit: null,
    videoPersonDailyLimit: null,
    videoPriorityPersonDailyLimit: null,
    videoNetworkDailyLimit: null,
  });
  return { readAdmissionControls: controls, readControls: controls };
});

import type { VideoArtifact } from "~/features/explainer/types";
import {
  isVideoLockHeld,
  reserveVideoSlot,
  resetUsageToday,
  takeGateLookup,
  takePremiumVideo,
  takeVideoAttempt,
  tryPaidVideoRun,
  tryVideoLock,
  videoLimitReached,
} from "./limits";
import { startTestRedis } from "./test-redis";
import {
  claimVideoIndexBuild,
  fillVideoIndex,
  indexVideo,
  readVideoIndex,
  videoCard,
} from "./video-index";

const originalEnv = { ...process.env };

beforeAll(async () => {
  redis.current = await startTestRedis();
}, 15_000);

afterEach(async () => {
  process.env = { ...originalEnv };
  await redis.current!.clear("video:v1:*");
});

afterAll(async () => {
  await redis.current?.clear("video:v1:*");
  await redis.current?.stop();
});

const person = (
  visitorId: string,
  clientIp: string | null = "203.0.113.9",
) => ({
  visitorId,
  clientIp,
});

function setLimits(limits: Record<string, number>) {
  for (const [name, value] of Object.entries(limits))
    process.env[name] = String(value);
}

describe("the daily video budget (Redis)", () => {
  it("counts everyone, each person and each connection, and refunds", async () => {
    setLimits({
      VIDEO_DAILY_LIMIT: 3,
      VIDEO_PERSON_DAILY_LIMIT: 1,
      VIDEO_NETWORK_DAILY_LIMIT: 2,
    });
    const alice = await reserveVideoSlot(person("alice"), { priority: false });
    expect(alice.ok).toBe(true);
    expect(
      await reserveVideoSlot(person("alice"), { priority: false }),
    ).toEqual({ ok: false, reason: "person", limit: 1 });
    expect(
      (await reserveVideoSlot(person("bob"), { priority: false })).ok,
    ).toBe(true);
    // Two from this connection already.
    expect(
      await reserveVideoSlot(person("carol"), { priority: false }),
    ).toEqual({ ok: false, reason: "network", limit: 2 });
    expect(
      (
        await reserveVideoSlot(person("carol", "198.51.100.1"), {
          priority: false,
        })
      ).ok,
    ).toBe(true);
    // Three made today: nobody else may start one.
    expect(
      await reserveVideoSlot(person("dave", "192.0.2.1"), { priority: false }),
    ).toEqual({ ok: false, reason: "daily", limit: 3 });
    expect(
      await videoLimitReached(person("dave", "192.0.2.1"), { priority: false }),
    ).toEqual({ reason: "daily", limit: 3 });

    // A refund gives every counter back.
    if (!alice.ok) throw new Error("expected a slot");
    await alice.refund();
    expect(
      await videoLimitReached(person("alice"), { priority: false }),
    ).toBeNull();
    expect(
      (await reserveVideoSlot(person("alice"), { priority: false })).ok,
    ).toBe(true);
  });

  it("blocks everyone when a limit is 0", async () => {
    setLimits({ VIDEO_DAILY_LIMIT: 0 });
    expect(
      await reserveVideoSlot(person("alice"), { priority: false }),
    ).toEqual({ ok: false, reason: "daily", limit: 0 });
    expect(
      await videoLimitReached(person("alice"), { priority: false }),
    ).toEqual({ reason: "daily", limit: 0 });
  });

  it("gives someone in a priority place their higher limit", async () => {
    setLimits({
      VIDEO_PERSON_DAILY_LIMIT: 1,
      VIDEO_PRIORITY_PERSON_DAILY_LIMIT: 2,
    });
    for (let index = 0; index < 2; index++)
      expect(
        (await reserveVideoSlot(person("alice"), { priority: true })).ok,
      ).toBe(true);
    expect(await reserveVideoSlot(person("alice"), { priority: true })).toEqual(
      { ok: false, reason: "person", limit: 2 },
    );
  });

  it("starts over in a new epoch, where an old refund frees nothing", async () => {
    setLimits({ VIDEO_PERSON_DAILY_LIMIT: 1 });
    const before = await reserveVideoSlot(person("alice"), { priority: false });
    if (!before.ok) throw new Error("expected a slot");
    await expect(resetUsageToday("generate")).resolves.toBe(1);

    const after = await reserveVideoSlot(person("alice"), { priority: false });
    expect(after.ok).toBe(true);
    await before.refund();
    // The refund landed in the old epoch: alice's new video still counts.
    expect(
      await reserveVideoSlot(person("alice"), { priority: false }),
    ).toEqual({ ok: false, reason: "person", limit: 1 });
  });
});

describe("premium videos (Redis)", () => {
  it("counts per person and per connection, all or nothing, and refunds both", async () => {
    setLimits({
      VIDEO_PREMIUM_PERSON_DAILY_LIMIT: 1,
      VIDEO_PREMIUM_NETWORK_DAILY_LIMIT: 2,
    });
    const alice = await takePremiumVideo(person("alice"));
    expect(alice).not.toBeNull();
    expect(await takePremiumVideo(person("alice"))).toBeNull();
    // A fresh visitor id on the same connection gets one more, then none.
    expect(await takePremiumVideo(person("fresh-1"))).not.toBeNull();
    expect(await takePremiumVideo(person("fresh-2"))).toBeNull();
    // A refused take counted nothing: fresh-2 still has theirs elsewhere.
    expect(
      await takePremiumVideo(person("fresh-2", "198.51.100.1")),
    ).not.toBeNull();

    await alice!.refund();
    expect(await takePremiumVideo(person("fresh-3"))).not.toBeNull();
  });
});

describe("paid runs at once (Redis)", () => {
  it("caps the public, never the operator, and frees places on release or expiry", async () => {
    setLimits({ VIDEO_MAX_PAID_RUNS: 2 });
    const first = await tryPaidVideoRun({ operator: false, ttlMs: 60_000 });
    const second = await tryPaidVideoRun({ operator: false, ttlMs: 60_000 });
    expect(first && second).toBeTruthy();
    expect(
      await tryPaidVideoRun({ operator: false, ttlMs: 60_000 }),
    ).toBeNull();
    const operator = await tryPaidVideoRun({ operator: true, ttlMs: 60_000 });
    expect(operator).not.toBeNull();

    await first!();
    await operator!();
    expect(
      await tryPaidVideoRun({ operator: false, ttlMs: 50 }),
    ).not.toBeNull();
    expect(
      await tryPaidVideoRun({ operator: false, ttlMs: 60_000 }),
    ).toBeNull();
    // A run that died without releasing loses its place when it expires.
    await delay(80);
    expect(
      await tryPaidVideoRun({ operator: false, ttlMs: 60_000 }),
    ).not.toBeNull();
  });
});

describe("the per-repository lock (Redis)", () => {
  it("has one holder, and a holder whose lock expired cannot free the next one's", async () => {
    const release = await tryVideoLock("generate:a/b", 50);
    expect(release).not.toBeNull();
    expect(await tryVideoLock("generate:a/b", 50)).toBeNull();
    expect(await isVideoLockHeld("generate:a/b")).toBe(true);

    await delay(80);
    const next = await tryVideoLock("generate:a/b", 60_000);
    expect(next).not.toBeNull();
    await release!();
    expect(await isVideoLockHeld("generate:a/b")).toBe(true);
    await next!();
    expect(await isVideoLockHeld("generate:a/b")).toBe(false);
    expect(await tryVideoLock("generate:a/b", 60_000)).not.toBeNull();
  });
});

describe("per-connection windows (Redis)", () => {
  it("allows so many attempts per window and gives none back", async () => {
    setLimits({ VIDEO_NETWORK_ATTEMPT_LIMIT: 2 });
    expect((await takeVideoAttempt("203.0.113.9")).ok).toBe(true);
    expect((await takeVideoAttempt("203.0.113.9")).ok).toBe(true);
    const third = await takeVideoAttempt("203.0.113.9");
    expect(third.ok).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    // Each connection has its own count, and the counter expires.
    expect((await takeVideoAttempt("198.51.100.1")).ok).toBe(true);
    const [key] = await redis.current!.command<string[]>([
      "KEYS",
      "video:v1:attempts:203.0.113.9:*",
    ]);
    const ttl = await redis.current!.command<number>(["TTL", key]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it("allows five feed lookups per connection", async () => {
    const results = [];
    for (let index = 0; index < 7; index++)
      results.push(await takeGateLookup("2001:db8::1"));
    expect(results).toEqual([true, true, true, true, true, false, false]);
    // The rest of the same /64 is the same connection.
    expect(await takeGateLookup("2001:db8::ffff")).toBe(false);
  });
});

describe("the gallery index (Redis)", () => {
  const artifact = (repo: string, createdAt: string) =>
    ({
      createdAt,
      repository: `acme/${repo}`,
      meta: { owner: "Acme", repo, stars: 1, language: "Go" },
      plan: { title: repo, beats: [{ narration: "Hi." }] },
      timing: { DURATION: 60 },
    }) as unknown as VideoArtifact;

  it("keeps the newest card, and marks the index ready only after a complete build", async () => {
    const older = artifact("widget", "2026-09-01T00:00:00.000Z");
    const newer = artifact("widget", "2026-09-02T00:00:00.000Z");
    await indexVideo(newer, { posterAt: 7 });
    // A late write for the version it replaced never wins.
    await indexVideo(older);
    expect(await readVideoIndex()).toEqual({
      ready: false,
      cards: [videoCard(newer, 7)],
    });

    // A build never overwrites a card written meanwhile.
    const other = videoCard(artifact("other", "2026-08-01T00:00:00.000Z"));
    await fillVideoIndex([videoCard(older), other], { complete: false });
    let index = await readVideoIndex();
    expect(index.ready).toBe(false);
    expect(index.cards).toHaveLength(2);
    expect(index.cards).toContainEqual(videoCard(newer, 7));

    await fillVideoIndex([other], { complete: true });
    index = await readVideoIndex();
    expect(index.ready).toBe(true);
    expect(index.cards).toHaveLength(2);
  });

  it("lets one caller build at a time", async () => {
    expect(await claimVideoIndexBuild()).toBe(true);
    expect(await claimVideoIndexBuild()).toBe(false);
    const ttl = await redis.current!.command<number>([
      "TTL",
      "video:v1:index:building",
    ]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });
});
