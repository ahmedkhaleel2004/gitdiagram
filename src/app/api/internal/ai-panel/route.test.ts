import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { runPanelStep } = vi.hoisted(() => ({ runPanelStep: vi.fn() }));
vi.mock("~/server/visibility/ai-panel", () => ({ runPanelStep }));

import { GET } from "./route";

const originalEnv = { ...process.env };
const call = (auth?: string, query = "") =>
  GET(
    new Request(`https://gitdiagram.com/api/internal/ai-panel${query}`, {
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

describe("the weekly prompt panel cron", () => {
  it("refuses callers without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(runPanelStep).not.toHaveBeenCalled();
  });

  it("runs a step, or starts the week over when asked", async () => {
    runPanelStep.mockResolvedValueOnce({ skipped: "done", week: "2026-11-09" });
    const done = await call("Bearer cron-secret");
    expect(await done.json()).toEqual({
      ok: true,
      skipped: "done",
      week: "2026-11-09",
    });
    expect(runPanelStep).toHaveBeenLastCalledWith(
      expect.objectContaining({ restart: false }),
    );
    runPanelStep.mockResolvedValueOnce({ week: "2026-11-09", asked: 3 });
    await call("Bearer cron-secret", "?restart=1");
    expect(runPanelStep).toHaveBeenLastCalledWith(
      expect.objectContaining({ restart: true }),
    );
  });

  it("answers 503 when the step fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    runPanelStep.mockRejectedValueOnce(new Error("Upstash down"));
    expect((await call("Bearer cron-secret")).status).toBe(503);
  });
});
