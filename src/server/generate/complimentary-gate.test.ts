import { afterEach, describe, expect, it, vi } from "vitest";

const checkQuotaInUpstash = vi.fn();
const commitQuotaUsageInUpstash = vi.fn();

vi.mock("~/server/storage/quota-store", () => ({
  checkQuotaInUpstash,
  commitQuotaUsageInUpstash,
}));

import {
  admitComplimentaryQuota,
  buildComplimentaryAdmissionTokens,
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

  it("normalizes the configured complimentary family before matching", () => {
    process.env.OPENAI_COMPLIMENTARY_MODEL_FAMILY = "gpt-5.4-mini-2026-03-17";

    expect(modelMatchesComplimentaryFamily("gpt-5.4-mini")).toBe(true);
  });

  it("builds a conservative whole-run admission estimate", () => {
    expect(
      buildComplimentaryAdmissionTokens({
        explanationInputTokens: 100,
        graphStaticInputTokens: 200,
      }),
    ).toBe(82_700);
  });

  it("returns a denial payload with the next UTC reset time", async () => {
    checkQuotaInUpstash.mockResolvedValue({
      admitted: false,
      usage: { usedTokens: 9_000_000 },
    });

    const result = await admitComplimentaryQuota({
      model: "gpt-5.4-mini",
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
      quotaBucket: "openai:gpt-5.4-mini:complimentary",
      requestedTokens: 82_700,
      tokenLimit: 10_000_000,
    });
  });

  it("finalizes exact committed usage against Upstash", async () => {
    commitQuotaUsageInUpstash.mockResolvedValue({
      usedTokens: 345,
    });

    await finalizeComplimentaryQuota({
      reservation: {
        quotaBucket: "openai:gpt-5.4-mini:complimentary",
        quotaDateUtc: "2026-03-28",
        quotaResetAt: "2026-03-29T00:00:00.000Z",
      },
      committedTokens: 345,
    });

    expect(commitQuotaUsageInUpstash).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai:gpt-5.4-mini:complimentary",
      committedTokens: 345,
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
      model: "gpt-5.4-mini",
      requestedTokens: 1_000,
      now: new Date("2026-03-28T12:34:56.000Z"),
    });

    expect(checkQuotaInUpstash).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai:gpt-5.4-mini:complimentary",
      requestedTokens: 1_000,
      tokenLimit: 10_000_000,
    });
    expect(reservation.admitted).toBe(true);

    if (!reservation.admitted) {
      throw new Error("expected admitted reservation");
    }

    await finalizeComplimentaryQuota({
      reservation: reservation.reservation,
      committedTokens: 345,
    });

    expect(commitQuotaUsageInUpstash).toHaveBeenCalledWith({
      quotaDateUtc: "2026-03-28",
      quotaBucket: "openai:gpt-5.4-mini:complimentary",
      committedTokens: 345,
    });
  });
});
