import { beforeEach, describe, expect, it, vi } from "vitest";

const { upstashEval } = vi.hoisted(() => ({
  upstashEval: vi.fn(),
}));

vi.mock("~/server/storage/upstash", () => ({
  upstashEval,
}));

import {
  buildQuotaKey,
  checkQuotaInUpstash,
  commitQuotaUsageInUpstash,
} from "~/server/storage/quota-store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildQuotaKey", () => {
  it("uses the shared complimentary group bucket for the daily key", () => {
    expect(
      buildQuotaKey("2026-03-30", "openai-complimentary-small-models"),
    ).toBe("quota:v2:2026-03-30:openai-complimentary-small-models");
  });

  it("atomically reserves requested tokens during admission", async () => {
    upstashEval.mockResolvedValue([1, 1_000]);

    await expect(
      checkQuotaInUpstash({
        quotaDateUtc: "2026-03-30",
        quotaBucket: "openai-complimentary-small-models",
        tokenLimit: 10_000_000,
        requestedTokens: 82_700,
      }),
    ).resolves.toEqual({ admitted: true, usage: { usedTokens: 1_000 } });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [10_000_000, 82_700, 259_200],
        keys: ["quota:v2:2026-03-30:openai-complimentary-small-models"],
        script: expect.stringContaining('HSET", key, "reserved_tokens"'),
      }),
    );
  });

  it("releases only the finalized reservation", async () => {
    upstashEval.mockResolvedValue(1_345);

    await expect(
      commitQuotaUsageInUpstash({
        quotaDateUtc: "2026-03-30",
        quotaBucket: "openai-complimentary-small-models",
        committedTokens: 345,
        reservationTokens: 82_700,
      }),
    ).resolves.toEqual({ usedTokens: 1_345 });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [345, 82_700, 259_200],
        keys: ["quota:v2:2026-03-30:openai-complimentary-small-models"],
        script: expect.stringContaining("reserved_tokens - math.max"),
      }),
    );
  });
});
