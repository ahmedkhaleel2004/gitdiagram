import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshVideoPagesHere = vi.fn();
vi.mock("~/server/explainer/cache", () => ({ refreshVideoPagesHere }));

const { POST } = await import("./route");

const call = (body: unknown, token = "s3cret") =>
  POST(
    new Request("https://gitdiagram.com/api/internal/revalidate", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/internal/revalidate", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    refreshVideoPagesHere.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refreshes a video's pages for the right secret", async () => {
    const response = await call({
      video: { username: "Vercel", repo: "next.js" },
    });
    expect(response.status).toBe(200);
    expect(refreshVideoPagesHere).toHaveBeenCalledWith("Vercel", "next.js");
  });

  it("refuses a wrong or missing secret", async () => {
    expect(
      (await call({ video: { username: "a", repo: "b" } }, "nope")).status,
    ).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect(
      (await call({ video: { username: "a", repo: "b" } }, "")).status,
    ).toBe(401);
    expect(refreshVideoPagesHere).not.toHaveBeenCalled();
  });

  it("refuses anything that is not a repository", async () => {
    expect((await call({ video: { username: "a/b", repo: "c" } })).status).toBe(
      400,
    );
    expect((await call({ tags: ["x"] })).status).toBe(400);
    expect(refreshVideoPagesHere).not.toHaveBeenCalled();
  });
});
