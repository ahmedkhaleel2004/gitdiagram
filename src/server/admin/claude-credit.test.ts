import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { costWindows, priceUsage, type CostWindow } from "./claude-credit";

const t = (iso: string) => Date.parse(iso);
const show = (windows: CostWindow[]) =>
  windows.map((window) => [
    window.source === "cost" ? "cost" : window.width,
    new Date(window.from).toISOString().slice(5, 16),
    new Date(window.to).toISOString().slice(5, 16),
  ]);

describe("Claude credit windows", () => {
  it("uses minute buckets within the same hour", () => {
    expect(
      show(costWindows(t("2026-09-25T05:42:34Z"), t("2026-09-25T05:58:10Z"))),
    ).toEqual([["1m", "09-25T05:43", "09-25T05:58"]]);
  });

  it("uses hourly buckets between whole hours on the same day", () => {
    expect(
      show(costWindows(t("2026-09-25T05:42:34Z"), t("2026-09-25T09:15:00Z"))),
    ).toEqual([
      ["1m", "09-25T05:43", "09-25T06:00"],
      ["1h", "09-25T06:00", "09-25T09:00"],
      ["1m", "09-25T09:00", "09-25T09:15"],
    ]);
  });

  it("uses the cost report for whole days in between", () => {
    expect(
      show(costWindows(t("2026-09-25T05:42:34Z"), t("2026-09-28T02:30:00Z"))),
    ).toEqual([
      ["1m", "09-25T05:43", "09-25T06:00"],
      ["1h", "09-25T06:00", "09-26T00:00"],
      ["cost", "09-26T00:00", "09-28T00:00"],
      ["1h", "09-28T00:00", "09-28T02:00"],
      ["1m", "09-28T02:00", "09-28T02:30"],
    ]);
  });

  it("covers the time without gaps or overlaps", () => {
    const since = t("2026-09-25T23:59:30Z");
    const now = t("2026-09-26T00:00:40Z");
    const windows = costWindows(since, now);
    expect(show(windows)).toEqual([["1m", "09-26T00:00", "09-26T00:00"]]);
    expect(windows[0]!.to).toBe(now);
    expect(costWindows(now, now)).toEqual([]);
  });
});

describe("Claude usage pricing", () => {
  it("matches the cost report for a day of Opus 5.5", () => {
    // 2026-09-24: the cost report said 2341.60212 cents for this usage.
    const usd = priceUsage({
      model: "claude-opus-5-5",
      uncached_input_tokens: 586_954,
      cache_creation: {
        ephemeral_1h_input_tokens: 0,
        ephemeral_5m_input_tokens: 1_833_512,
      },
      cache_read_input_tokens: 11_453_126,
      output_tokens: 480_501,
    });
    expect(usd).toBeCloseTo(23.4160212, 6);
  });

  it("prices unknown models as the most expensive", () => {
    const row = {
      uncached_input_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    };
    expect(priceUsage({ ...row, model: "claude-new" })).toBe(10);
    expect(priceUsage({ ...row, model: null })).toBe(10);
  });
});
