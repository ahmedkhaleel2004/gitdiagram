import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { runAiVisibility } = vi.hoisted(() => ({ runAiVisibility: vi.fn() }));
vi.mock("~/server/visibility/ai-visibility", () => ({ runAiVisibility }));

import { GET } from "./route";

const originalEnv = { ...process.env };
const call = (auth?: string, query = "") =>
  GET(
    new Request(`https://gitdiagram.com/api/internal/ai-visibility${query}`, {
      headers: auth ? { authorization: auth } : {},
    }),
  );

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("the daily AI visibility cron", () => {
  it("refuses callers without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401);
    expect(runAiVisibility).not.toHaveBeenCalled();
  });

  it("runs once a day, or again when forced", async () => {
    runAiVisibility.mockResolvedValueOnce(null);
    const skipped = await call("Bearer cron-secret");
    expect(await skipped.json()).toEqual({ ok: true, skipped: "already ran" });
    expect(runAiVisibility).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: false }),
    );

    runAiVisibility.mockResolvedValueOnce({ date: "2026-09-29" });
    const forced = await call("Bearer cron-secret", "?force=1");
    expect(await forced.json()).toEqual({
      ok: true,
      summary: { date: "2026-09-29" },
    });
    expect(runAiVisibility).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true }),
    );
  });

  it("answers 503 when the run fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    runAiVisibility.mockRejectedValueOnce(new Error("Upstash down"));
    expect((await call("Bearer cron-secret")).status).toBe(503);
  });
});
