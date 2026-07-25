// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkReadiness } = vi.hoisted(() => ({
  checkReadiness: vi.fn(),
}));

vi.mock("~/server/readiness", () => ({
  checkReadiness,
}));

import { GET } from "./route";

describe("GET /api/healthz", () => {
  beforeEach(() => {
    checkReadiness.mockReset();
  });

  it("returns 200 only when required dependencies are ready", async () => {
    checkReadiness.mockResolvedValue({
      ok: true,
      checks: {
        configuration: true,
        provider: true,
        publicStorage: true,
        privateStorage: true,
        redis: true,
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "ok",
    });
  });

  it("returns 503 when a required dependency is unavailable", async () => {
    checkReadiness.mockResolvedValue({
      ok: false,
      checks: {
        configuration: true,
        provider: true,
        publicStorage: true,
        privateStorage: true,
        redis: false,
      },
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "unavailable",
      checks: { redis: false },
    });
  });
});
