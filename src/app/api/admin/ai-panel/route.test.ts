import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { verifyAdminRequest, getPanelView } = vi.hoisted(() => ({
  verifyAdminRequest: vi.fn(),
  getPanelView: vi.fn(),
}));
vi.mock("~/server/admin/operator", () => ({ verifyAdminRequest }));
vi.mock("~/server/visibility/ai-panel", () => ({ getPanelView }));

import { GET } from "./route";

const call = () =>
  GET(new Request("https://gitdiagram.com/api/admin/ai-panel"));

afterEach(() => {
  vi.clearAllMocks();
});

describe("the admin prompt-gaps report", () => {
  it("is for the operator only", async () => {
    verifyAdminRequest.mockResolvedValueOnce(false);
    expect((await call()).status).toBe(401);
    expect(getPanelView).not.toHaveBeenCalled();
  });

  it("returns the report, uncached", async () => {
    verifyAdminRequest.mockResolvedValueOnce(true);
    getPanelView.mockResolvedValueOnce({ latest: null, history: [] });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ latest: null, history: [] });
  });

  it("answers 503 when Redis cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    verifyAdminRequest.mockResolvedValueOnce(true);
    getPanelView.mockRejectedValueOnce(new Error("down"));
    expect((await call()).status).toBe(503);
  });
});
