import { afterEach, describe, expect, it, vi } from "vitest";

const { checkQuotaInUpstash, commitQuotaUsageInUpstash } = vi.hoisted(() => ({
  checkQuotaInUpstash: vi.fn(),
  commitQuotaUsageInUpstash: vi.fn(),
}));

vi.mock("~/server/storage/quota-store", () => ({
  checkQuotaInUpstash,
  commitQuotaUsageInUpstash,
}));

import {
  admitComplimentaryQuota,
  buildComplimentaryAdmissionTokens,
  buildComplimentaryStageTokenBound,
  finalizeComplimentaryQuota,
  modelMatchesComplimentaryFamily,
  shouldApplyComplimentaryGate,
} from "~/server/generate/complimentary-gate";

describe("complimentary gate", () => {
  afterEach(() => {
    delete process.env.OPENAI_COMPLIMENTARY_GATE_ENABLED;
    delete process.env.OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS;
    delete process.env.OPENAI_COMPLIMENTARY_MODEL_FAMILY;
    vi.clearAllMocks();
  });

  it("applies only to the default OpenAI key when enabled", () => {
    process.env.OPENAI_COMPLIMENTARY_GATE_ENABLED = "true";

    expect(
      shouldApplyComplimentaryGate({
        provider: "openai",
      }),
    ).toBe(true);
    expect(
      shouldApplyComplimentaryGate({
        provider: "openai",
        apiKey: "sk-user",
      }),
    ).toBe(false);
    expect(
      shouldApplyComplimentaryGate({
        provider: "openrouter",
      }),
    ).toBe(false);
  });

  it("matches the complimentary family by resolved pricing model", () => {
    process.env.OPENAI_COMPLIMENTARY_MODEL_FAMILY = "gpt-5.6-terra";

    expect(modelMatchesComplimentaryFamily("gpt-5.6-terra-2026-07-09")).toBe(
      true,
    );
    expect(modelMatchesComplimentaryFamily("gpt-5.4")).toBe(false);
    expect(modelMatchesComplimentaryFamily("not-a-real-model")).toBe(false);
  });

  it("normalizes the configured complimentary family before matching", () => {
    process.env.OPENAI_COMPLIMENTARY_MODEL_FAMILY = "gpt-5.6-terra-2026-07-09";

    expect(modelMatchesComplimentaryFamily("gpt-5.6-terra")).toBe(true);
  });

  it("uses repair-static input only for graph retry admission estimates", () => {
    const estimate = {
      explanationInputTokens: 100,
      graphStaticInputTokens: 200,
      graphRepairStaticInputTokens: 300,
    };

    expect(buildComplimentaryAdmissionTokens(estimate)).toBe(58_900);
    expect(
      buildComplimentaryStageTokenBound(estimate, { stage: "explanation" }),
    ).toBe(6_100);
    expect(
      buildComplimentaryStageTokenBound(estimate, {
        stage: "graph",
        attempt: 1,
      }),
    ).toBe(12_200);
    expect(
      buildComplimentaryStageTokenBound(estimate, {
        stage: "graph",
        attempt: 2,
      }),
    ).toBe(20_300);
  });

  it("returns a denial payload with the next UTC reset time", async () => {
    checkQuotaInUpstash.mockResolvedValue({
      admitted: false,
      usage: { usedTokens: 9_000_000 },
    });

    const result = await admitComplimentaryQuota({
      model: "gpt-5.6-terra",
      requestedTokens: 82_700,
      now: new Date("2026-03-28T12:34:56.000Z"),
    });

    expect(result).toEqual({
      admitted: false,
      message:
        "GitDiagram's free daily OpenAI capacity is used up for now. I'm a solo student engineer running this free and open source, so please try again after 00:00 UTC or use your own OpenAI API key.",
      quotaResetAt: "2026-03-29T00:00:00.000Z",
    });
    expect(checkQuotaInUpstash).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai-complimentary-small-models",
      requestedTokens: 82_700,
      tokenLimit: 10_000_000,
      reservationId: expect.any(String),
    });
  });

  it("finalizes exact committed usage against Upstash", async () => {
    commitQuotaUsageInUpstash.mockResolvedValue({
      usedTokens: 345,
    });

    await finalizeComplimentaryQuota({
      reservation: {
        reservationId: "reservation-a",
        quotaBucket: "openai-complimentary-small-models",
        quotaDateUtc: "2026-03-28",
        quotaResetAt: "2026-03-29T00:00:00.000Z",
        reservedTokens: 1_000,
      },
      committedTokens: 345,
    });

    expect(commitQuotaUsageInUpstash).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai-complimentary-small-models",
      committedTokens: 345,
      reservationId: "reservation-a",
    });
  });

  it("routes quota operations through Upstash", async () => {
    checkQuotaInUpstash.mockResolvedValue({
      admitted: true,
      usage: { usedTokens: 1_000 },
    });
    commitQuotaUsageInUpstash.mockResolvedValue({
      usedTokens: 1_345,
    });

    const reservation = await admitComplimentaryQuota({
      model: "gpt-5.6-terra",
      requestedTokens: 1_000,
      now: new Date("2026-03-28T12:34:56.000Z"),
    });

    expect(checkQuotaInUpstash).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai-complimentary-small-models",
      requestedTokens: 1_000,
      tokenLimit: 10_000_000,
      reservationId: expect.any(String),
    });
    expect(reservation.admitted).toBe(true);

    if (!reservation.admitted) {
      throw new Error("expected admitted reservation");
    }

    expect(reservation.reservation.reservedTokens).toBe(1_000);
    expect(reservation.reservation.reservationId).toEqual(expect.any(String));

    await finalizeComplimentaryQuota({
      reservation: reservation.reservation,
      committedTokens: 345,
    });

    expect(commitQuotaUsageInUpstash).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai-complimentary-small-models",
      committedTokens: 345,
      reservationId: reservation.reservation.reservationId,
    });
  });

  it("safely retries an ambiguous finalization once", async () => {
    commitQuotaUsageInUpstash
      .mockRejectedValueOnce(new Error("request timed out"))
      .mockResolvedValueOnce({ usedTokens: 345 });

    await finalizeComplimentaryQuota({
      reservation: {
        reservationId: "reservation-a",
        quotaBucket: "openai-complimentary-small-models",
        quotaDateUtc: "2026-03-28",
        quotaResetAt: "2026-03-29T00:00:00.000Z",
        reservedTokens: 1_000,
      },
      committedTokens: 345,
    });

    expect(commitQuotaUsageInUpstash).toHaveBeenCalledTimes(2);
    expect(commitQuotaUsageInUpstash).toHaveBeenNthCalledWith(2, {
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai-complimentary-small-models",
      committedTokens: 345,
      reservationId: "reservation-a",
    });
  });
});
