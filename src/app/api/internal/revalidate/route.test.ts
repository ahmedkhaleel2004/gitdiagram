import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshVideoPagesHere = vi.fn();
vi.mock("~/server/explainer/cache", () => ({ refreshVideoPagesHere }));
const dropEdgeAnswers = vi.fn(async (_urls: URL[]) => undefined);
vi.mock("~/server/edge-answers", () => ({ dropEdgeAnswers }));

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
    // The kept GET /api/video answers, as asked for and in lowercase.
    expect(dropEdgeAnswers.mock.calls[0]![0].map(String)).toEqual([
      "https://gitdiagram.com/api/video?username=Vercel&repo=next.js",
      "https://gitdiagram.com/api/video?username=vercel&repo=next.js",
    ]);
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
