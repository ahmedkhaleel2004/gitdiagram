import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upstashEval } = vi.hoisted(() => ({
  upstashEval: vi.fn(),
}));

vi.mock("~/server/storage/upstash", () => ({
  upstashEval,
}));

import {
  buildGenerationRateLimitKey,
  consumeGenerationRateLimit,
  getGenerationRateLimitMax,
  getGenerationRateLimitMessage,
  getGenerationRateLimitWindowSeconds,
  refundGenerationRateLimit,
  toRateLimitBucket,
} from "~/server/generate/rate-limit";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("generation rate limit configuration", () => {
  it("falls back to safe defaults when unset", () => {
    delete process.env.GENERATION_RATE_LIMIT_MAX;
    delete process.env.GENERATION_RATE_LIMIT_WINDOW_SECONDS;

    expect(getGenerationRateLimitMax()).toBe(8);
    expect(getGenerationRateLimitWindowSeconds()).toBe(3_600);
  });

  it("ignores non-positive overrides rather than disabling the limiter", () => {
    process.env.GENERATION_RATE_LIMIT_MAX = "0";
    process.env.GENERATION_RATE_LIMIT_WINDOW_SECONDS = "-5";

    expect(getGenerationRateLimitMax()).toBe(8);
    expect(getGenerationRateLimitWindowSeconds()).toBe(3_600);
  });

  it("namespaces buckets per caller so one IP cannot evict another", () => {
    expect(buildGenerationRateLimitKey("203.0.113.7")).toBe(
      "ratelimit:v1:generate:203.0.113.7",
    );
    expect(buildGenerationRateLimitKey("2001:db8::1")).not.toBe(
      buildGenerationRateLimitKey("203.0.113.7"),
    );
  });

  it("reports the wait in whole minutes, never rounding down to zero", () => {
    expect(getGenerationRateLimitMessage(30)).toContain("1 minute");
    expect(getGenerationRateLimitMessage(600)).toContain("10 minutes");
  });
});

describe("consumeGenerationRateLimit", () => {
  it("admits a caller under the limit", async () => {
    upstashEval.mockResolvedValue([1, 3_400]);

    await expect(
      consumeGenerationRateLimit({ clientIp: "203.0.113.7" }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 3_400 });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: ["ratelimit:v1:generate:203.0.113.7"],
        args: [8, 3_600],
      }),
    );
  });

  it("rejects a caller over the limit and reports the remaining window", async () => {
    upstashEval.mockResolvedValue([0, 120]);

    await expect(
      consumeGenerationRateLimit({ clientIp: "203.0.113.7" }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 120 });
  });

  it("skips the round trip when the caller is unattributable", async () => {
    await expect(
      consumeGenerationRateLimit({ clientIp: null }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });

    expect(upstashEval).not.toHaveBeenCalled();
  });

  it("fails open so a Redis outage cannot take generation down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    upstashEval.mockRejectedValue(new Error("upstash unavailable"));

    await expect(
      consumeGenerationRateLimit({ clientIp: "203.0.113.7" }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
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

    await refundGenerationRateLimit({ clientIp: "203.0.113.7" });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({ keys: ["ratelimit:v1:generate:203.0.113.7"] }),
    );
  });

  it("skips the round trip when the caller is unattributable", async () => {
    await refundGenerationRateLimit({ clientIp: null });

    expect(upstashEval).not.toHaveBeenCalled();
  });

  it("swallows Redis failures so a refund cannot fail the response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    upstashEval.mockRejectedValue(new Error("upstash unavailable"));

    await expect(
      refundGenerationRateLimit({ clientIp: "203.0.113.7" }),
    ).resolves.toBeUndefined();
  });
});
