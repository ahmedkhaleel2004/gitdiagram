import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upstashEval } = vi.hoisted(() => ({
  upstashEval: vi.fn(),
}));

vi.mock("~/server/storage/upstash", () => ({
  upstashEval,
}));

import {
  buildGenerationInfrastructureRateLimitKey,
  buildGenerationRateLimitKey,
  consumeGenerationInfrastructureRateLimit,
  consumeGenerationRateLimit,
  getGenerationInfrastructureRateLimitMax,
  getGenerationRateLimitMax,
  getGenerationRateLimitMessage,
  getGenerationRateLimitWindowSeconds,
  refundGenerationRateLimit,
  toRateLimitBucket,
} from "~/server/generate/rate-limit";

const originalEnv = { ...process.env };

// Half past the hour, so the aligned window is unambiguous: it started at
// 00:00:00Z and has 1800 seconds left to run.
const NOW_MS = Date.parse("2026-01-01T00:30:00Z");
const WINDOW_START_SECONDS = 1_767_225_600;
const WINDOW_REMAINING_SECONDS = 1_800;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("generation rate limit configuration", () => {
  it("falls back to safe defaults when unset", () => {
    delete process.env.GENERATION_RATE_LIMIT_MAX;
    delete process.env.GENERATION_RATE_LIMIT_WINDOW_SECONDS;

    expect(getGenerationRateLimitMax()).toBe(8);
    expect(getGenerationInfrastructureRateLimitMax()).toBe(60);
    expect(getGenerationRateLimitWindowSeconds()).toBe(3_600);
  });

  it("ignores non-positive overrides rather than disabling the limiter", () => {
    process.env.GENERATION_RATE_LIMIT_MAX = "0";
    process.env.GENERATION_RATE_LIMIT_WINDOW_SECONDS = "-5";

    expect(getGenerationRateLimitMax()).toBe(8);
    expect(getGenerationInfrastructureRateLimitMax()).toBe(60);
    expect(getGenerationRateLimitWindowSeconds()).toBe(3_600);
  });

  it("uses a separate infrastructure namespace", () => {
    expect(
      buildGenerationInfrastructureRateLimitKey(
        "203.0.113.7",
        WINDOW_START_SECONDS,
      ),
    ).toBe(
      `ratelimit:v2:generate-infrastructure:203.0.113.7:${WINDOW_START_SECONDS}`,
    );
    expect(
      buildGenerationInfrastructureRateLimitKey(
        "203.0.113.7",
        WINDOW_START_SECONDS,
      ),
    ).not.toBe(
      buildGenerationRateLimitKey("203.0.113.7", WINDOW_START_SECONDS),
    );
  });

  it("namespaces buckets per caller so one IP cannot evict another", () => {
    expect(
      buildGenerationRateLimitKey("203.0.113.7", WINDOW_START_SECONDS),
    ).toBe(`ratelimit:v2:generate:203.0.113.7:${WINDOW_START_SECONDS}`);
    expect(
      buildGenerationRateLimitKey("2001:db8::1", WINDOW_START_SECONDS),
    ).not.toBe(
      buildGenerationRateLimitKey("203.0.113.7", WINDOW_START_SECONDS),
    );
  });

  it("gives each window its own key so counters never blend together", () => {
    expect(
      buildGenerationRateLimitKey("203.0.113.7", WINDOW_START_SECONDS),
    ).not.toBe(
      buildGenerationRateLimitKey("203.0.113.7", WINDOW_START_SECONDS + 3_600),
    );
  });

  it("reports the wait in whole minutes, never rounding down to zero", () => {
    expect(getGenerationRateLimitMessage(30)).toContain("1 minute");
    expect(getGenerationRateLimitMessage(600)).toContain("10 minutes");
  });
});

describe("consumeGenerationRateLimit", () => {
  it("admits a caller under the limit", async () => {
    upstashEval.mockResolvedValue([1, 1_700]);

    await expect(
      consumeGenerationRateLimit({ clientIp: "203.0.113.7" }),
    ).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 1_700,
      consumed: true,
      windowStartSeconds: WINDOW_START_SECONDS,
    });

    // The key carries the window, and the TTL is only the remainder of it, so
    // the window closes on its own clock rather than sliding per caller.
    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [`ratelimit:v2:generate:203.0.113.7:${WINDOW_START_SECONDS}`],
        args: [8, WINDOW_REMAINING_SECONDS],
      }),
    );
  });

  it("rejects a caller over the limit and reports the remaining window", async () => {
    upstashEval.mockResolvedValue([0, 120]);

    await expect(
      consumeGenerationRateLimit({ clientIp: "203.0.113.7" }),
    ).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 120,
      consumed: true,
      windowStartSeconds: WINDOW_START_SECONDS,
    });
  });

  it("skips the round trip when the caller is unattributable", async () => {
    await expect(
      consumeGenerationRateLimit({ clientIp: null }),
    ).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      consumed: false,
      windowStartSeconds: WINDOW_START_SECONDS,
    });

    expect(upstashEval).not.toHaveBeenCalled();
  });

  it("fails open so a Redis outage cannot take generation down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    upstashEval.mockRejectedValue(new Error("upstash unavailable"));

    await expect(
      consumeGenerationRateLimit({ clientIp: "203.0.113.7" }),
    ).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      consumed: false,
      windowStartSeconds: WINDOW_START_SECONDS,
    });
  });
});

describe("consumeGenerationInfrastructureRateLimit", () => {
  it("limits infrastructure work independently from model spend", async () => {
    upstashEval.mockResolvedValue([1, 1_700]);

    await expect(
      consumeGenerationInfrastructureRateLimit({
        clientIp: "203.0.113.7",
      }),
    ).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 1_700,
      consumed: true,
      windowStartSeconds: WINDOW_START_SECONDS,
    });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [
          `ratelimit:v2:generate-infrastructure:203.0.113.7:${WINDOW_START_SECONDS}`,
        ],
        args: [60, WINDOW_REMAINING_SECONDS],
      }),
    );
  });
});

describe("toRateLimitBucket", () => {
  it("leaves IPv4 addresses alone", () => {
    expect(toRateLimitBucket("203.0.113.7")).toBe("203.0.113.7");
  });

  it("collapses an IPv6 address to its /64 prefix", () => {
    // A single allocation spans the whole /64, so every address inside it has
    // to share one bucket or the limiter is trivially bypassed.
    expect(toRateLimitBucket("2001:db8:1:2:3:4:5:6")).toBe(
      "2001:0db8:0001:0002::/64",
    );
    expect(toRateLimitBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(
      toRateLimitBucket("2001:db8:1:2:1111:2222:3333:4444"),
    );
    expect(toRateLimitBucket("2001:db8:1:3::1")).not.toBe(
      toRateLimitBucket("2001:db8:1:2::1"),
    );
  });

  it("expands compressed forms before truncating", () => {
    expect(toRateLimitBucket("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(toRateLimitBucket("::1")).toBe("0000:0000:0000:0000::/64");
  });

  it("does not reshape an embedded IPv4 literal", () => {
    expect(toRateLimitBucket("::ffff:203.0.113.7")).toBe("::ffff:203.0.113.7");
  });
});

describe("refundGenerationRateLimit", () => {
  it("returns a slot consumed by a request that never reached a model call", async () => {
    upstashEval.mockResolvedValue(1);

    await refundGenerationRateLimit({
      clientIp: "203.0.113.7",
      windowStartSeconds: WINDOW_START_SECONDS,
    });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [`ratelimit:v2:generate:203.0.113.7:${WINDOW_START_SECONDS}`],
      }),
    );
  });

  it("refunds the window the slot was charged to, not the current one", async () => {
    upstashEval.mockResolvedValue(0);
    const consumedWindowStartSeconds = WINDOW_START_SECONDS - 3_600;

    // A refund queued as a post-response task can outlive the window it was
    // charged in. It has to target the old (now expired) key and lapse into a
    // no-op, rather than decrementing the current window and handing the bucket
    // an extra slot it never paid for.
    await refundGenerationRateLimit({
      clientIp: "203.0.113.7",
      windowStartSeconds: consumedWindowStartSeconds,
    });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [
          `ratelimit:v2:generate:203.0.113.7:${consumedWindowStartSeconds}`,
        ],
      }),
    );
    expect(upstashEval).not.toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [`ratelimit:v2:generate:203.0.113.7:${WINDOW_START_SECONDS}`],
      }),
    );
  });

  it("skips the round trip when the caller is unattributable", async () => {
    await refundGenerationRateLimit({
      clientIp: null,
      windowStartSeconds: WINDOW_START_SECONDS,
    });

    expect(upstashEval).not.toHaveBeenCalled();
  });

  it("swallows Redis failures so a refund cannot fail the response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    upstashEval.mockRejectedValue(new Error("upstash unavailable"));

    await expect(
      refundGenerationRateLimit({
        clientIp: "203.0.113.7",
        windowStartSeconds: WINDOW_START_SECONDS,
      }),
    ).resolves.toBeUndefined();
  });
});
