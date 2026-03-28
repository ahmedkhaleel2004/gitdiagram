import { afterEach, describe, expect, it, vi } from "vitest";

const {
  reserveComplimentaryQuotaInDb,
  finalizeComplimentaryQuotaInDb,
} = vi.hoisted(() => ({
  reserveComplimentaryQuotaInDb: vi.fn(),
  finalizeComplimentaryQuotaInDb: vi.fn(),
}));

vi.mock("~/server/db/complimentary-quota", () => ({
  reserveComplimentaryQuota: reserveComplimentaryQuotaInDb,
  finalizeComplimentaryQuota: finalizeComplimentaryQuotaInDb,
}));

import {
  buildComplimentaryReservationTokens,
  finalizeComplimentaryQuota,
  modelMatchesComplimentaryFamily,
  reserveComplimentaryQuota,
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
        model: "gpt-5.4-mini",
      }),
    ).toBe(true);
    expect(
      shouldApplyComplimentaryGate({
        provider: "openai",
        model: "gpt-5.4-mini",
        apiKey: "sk-user",
      }),
    ).toBe(false);
    expect(
      shouldApplyComplimentaryGate({
        provider: "openrouter",
        model: "openai/gpt-5.4",
      }),
    ).toBe(false);
  });

  it("matches the complimentary family by resolved pricing model", () => {
    process.env.OPENAI_COMPLIMENTARY_MODEL_FAMILY = "gpt-5.4-mini";

    expect(modelMatchesComplimentaryFamily("gpt-5.4-mini-2026-03-17")).toBe(true);
    expect(modelMatchesComplimentaryFamily("gpt-5.4")).toBe(false);
  });

  it("builds a conservative whole-run token reservation", () => {
    expect(
      buildComplimentaryReservationTokens({
        explanationInputTokens: 100,
        graphStaticInputTokens: 200,
      }),
    ).toBe(50_700);
  });

  it("returns a denial payload with the next UTC reset time", async () => {
    reserveComplimentaryQuotaInDb.mockResolvedValue({
      admitted: false,
      usage: { usedTokens: 9_000_000, reservedTokens: 1_000_000 },
    });

    const result = await reserveComplimentaryQuota({
      model: "gpt-5.4-mini",
      reservationTokens: 50_700,
      now: new Date("2026-03-28T12:34:56.000Z"),
    });

    expect(result).toEqual({
      admitted: false,
      message:
        "GitDiagram's free daily OpenAI capacity is used up for now. I'm a solo student engineer running this free and open source, so please try again after 00:00 UTC or use your own OpenAI API key.",
      quotaResetAt: "2026-03-29T00:00:00.000Z",
    });
    expect(reserveComplimentaryQuotaInDb).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai:gpt-5.4-mini:complimentary",
      reservationTokens: 50_700,
      tokenLimit: 10_000_000,
    });
  });

  it("finalizes a reservation against the quota store", async () => {
    finalizeComplimentaryQuotaInDb.mockResolvedValue(undefined);

    await finalizeComplimentaryQuota({
      reservation: {
        quotaBucket: "openai:gpt-5.4-mini:complimentary",
        quotaDateUtc: "2026-03-28",
        quotaResetAt: "2026-03-29T00:00:00.000Z",
        reservedTokens: 50_700,
      },
      committedTokens: 345,
    });

    expect(finalizeComplimentaryQuotaInDb).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai:gpt-5.4-mini:complimentary",
      reservationTokens: 50_700,
      committedTokens: 345,
    });
  });
});
