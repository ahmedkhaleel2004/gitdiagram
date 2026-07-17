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
        reservationId: "reservation-a",
      }),
    ).resolves.toEqual({ admitted: true, usage: { usedTokens: 1_000 } });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [10_000_000, 82_700, 259_200, "reservation-a"],
        keys: ["quota:v2:2026-03-30:openai-complimentary-small-models"],
        script: expect.stringContaining('reservation_field = "reservation:"'),
      }),
    );
  });

  it("finalizes a reservation by identity so duplicate calls are idempotent", async () => {
    upstashEval.mockResolvedValue(1_345);

    await expect(
      commitQuotaUsageInUpstash({
        quotaDateUtc: "2026-03-30",
        quotaBucket: "openai-complimentary-small-models",
        committedTokens: 345,
        reservationId: "reservation-a",
      }),
    ).resolves.toEqual({ usedTokens: 1_345 });

    expect(upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [345, 259_200, "reservation-a"],
        keys: ["quota:v2:2026-03-30:openai-complimentary-small-models"],
        script: expect.stringContaining('HEXISTS", key, finalized_field'),
      }),
    );
  });

  it("keeps concurrent reservations distinct inside the atomic quota hash", async () => {
    upstashEval.mockResolvedValue([1, 1_000]);

    await Promise.all([
      checkQuotaInUpstash({
        quotaDateUtc: "2026-03-30",
        quotaBucket: "openai-complimentary-small-models",
        tokenLimit: 10_000_000,
        requestedTokens: 10_000,
        reservationId: "reservation-a",
      }),
      checkQuotaInUpstash({
        quotaDateUtc: "2026-03-30",
        quotaBucket: "openai-complimentary-small-models",
        tokenLimit: 10_000_000,
        requestedTokens: 20_000,
        reservationId: "reservation-b",
      }),
    ]);

    expect(upstashEval.mock.calls.map(([call]) => call.args?.at(-1))).toEqual([
      "reservation-a",
      "reservation-b",
    ]);
  });
});
