// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { drainPendingBrowseIndex } = vi.hoisted(() => ({
  drainPendingBrowseIndex: vi.fn(),
}));

vi.mock("~/server/storage/browse-diagrams", () => ({
  drainPendingBrowseIndex,
}));

import { GET } from "./route";

function request(secret = "cron-secret") {
  return new Request("https://gitdiagram.com/api/internal/browse-index/drain", {
    headers: { Authorization: `Bearer ${secret}` },
  });
}

describe("browse index drain cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    drainPendingBrowseIndex.mockReset();
    drainPendingBrowseIndex.mockResolvedValue(82_087);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("rejects requests without the Vercel cron secret", async () => {
    const response = await GET(request("wrong"));

    expect(response.status).toBe(401);
    expect(drainPendingBrowseIndex).not.toHaveBeenCalled();
  });

  it("drains the durable journal for an authenticated cron", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      entry_count: 82_087,
    });
    expect(drainPendingBrowseIndex).toHaveBeenCalledOnce();
  });

  it("keeps failures retryable by returning a non-success status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    drainPendingBrowseIndex.mockRejectedValue(new Error("R2 unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });
});
