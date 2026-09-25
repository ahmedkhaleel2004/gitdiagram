import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { upstashCommand } = vi.hoisted(() => ({ upstashCommand: vi.fn() }));
vi.mock("~/server/storage/upstash", () => ({ upstashCommand }));

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

describe("reading the Claude credit", () => {
  // A fresh module per test: nothing cached from another test.
  const load = () => import("./claude-credit");
  const originalEnv = process.env;
  let anchor: string[] | null;
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, ANTHROPIC_ADMIN_KEY: "sk-ant-admin-test" };
    // Entered five minutes ago, so reading spend takes one report.
    anchor = ["usd", "50", "at", String(Date.now() - 5 * 60_000)];
    upstashCommand.mockReset();
    upstashCommand.mockImplementation(async (command: unknown[]) => {
      if (command[0] === "HGETALL") return anchor;
      if (command[0] === "HSET") return 2;
      throw new Error(`Unexpected ${String(command[0])}`);
    });
    fetch = vi.fn(async () => new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("is null without an admin key, and asks nobody", async () => {
    delete process.env.ANTHROPIC_ADMIN_KEY;
    const { readClaudeCredit } = await load();
    await expect(readClaudeCredit()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a failed read for the minute, so a 429 is not asked again each poll", async () => {
    const { readClaudeCredit } = await load();
    await expect(readClaudeCredit()).rejects.toThrow("429");
    await expect(readClaudeCredit()).rejects.toThrow("429");
    await expect(readClaudeCredit()).rejects.toThrow("429");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("works it out again when a balance was entered through another instance", async () => {
    fetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ data: [], has_more: false, next_page: null }),
        ),
    );
    const { readClaudeCredit } = await load();
    expect(await readClaudeCredit()).toMatchObject({ setUsd: 50 });
    const at = Date.now();
    anchor = ["usd", "80", "at", String(at)];
    expect(await readClaudeCredit()).toEqual({
      setUsd: 80,
      setAt: at,
      spentUsd: 0,
    });
  });

  it("answers a new balance with the credit as it now stands", async () => {
    const { readClaudeCredit, setClaudeCredit } = await load();
    const credit = await setClaudeCredit(25);
    expect(credit).toEqual({
      setUsd: 25,
      setAt: expect.any(Number) as number,
      spentUsd: 0,
    });
    anchor = ["usd", "25", "at", String(credit.setAt)];
    await expect(readClaudeCredit()).resolves.toEqual(credit);
    expect(fetch).not.toHaveBeenCalled();
  });
});
