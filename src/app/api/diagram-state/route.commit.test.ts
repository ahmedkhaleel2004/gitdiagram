// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDiagramStateRecord: vi.fn(),
  resolveRequestCredentials: vi.fn(),
  resolveCommit: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("~/server/storage/diagram-state", () => ({
  getDiagramStateRecord: mocks.getDiagramStateRecord,
}));
vi.mock("~/server/http/request-credentials", () => ({
  resolveRequestCredentials: mocks.resolveRequestCredentials,
}));
vi.mock("~/server/generate/github", () => ({
  resolveCommit: mocks.resolveCommit,
}));
vi.mock("~/server/generate/rate-limit", () => ({
  consumeGenerationInfrastructureRateLimit: mocks.consumeRateLimit,
  getGenerationInfrastructureRateLimitMessage: (seconds: number) =>
    `Slow down for ${seconds}s.`,
}));

import { POST } from "~/app/api/diagram-state/route";
import { CommitResolutionError } from "~/server/generate/github-errors";

const FULL = "0123456789abcdef0123456789abcdef01234567";

function request(body: unknown): Request {
  return new Request("https://gitdiagram.com/api/diagram-state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gitdiagram.com",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

const state = {
  diagram: "flowchart TD\nA-->B",
  explanation: "Example",
  graph: null,
  latestSessionAudit: null,
  lastSuccessfulAt: "2026-07-13T12:00:00.000Z",
  commit: FULL,
};

describe("POST /api/diagram-state with a commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.resolveRequestCredentials.mockImplementation(
      async (_request: Request, { githubPat }: { githubPat?: string }) => ({
        githubPat,
      }),
    );
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
    mocks.getDiagramStateRecord.mockResolvedValue(state);
  });

  it("reads a full SHA straight from storage without asking GitHub", async () => {
    const response = await POST(
      request({ username: "acme", repo: "demo", commit: FULL.toUpperCase() }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(state);
    expect(mocks.getDiagramStateRecord).toHaveBeenCalledWith(
      "acme",
      "demo",
      undefined,
      FULL,
    );
    expect(mocks.resolveCommit).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("resolves a short SHA first and reads storage under the full one", async () => {
    mocks.resolveCommit.mockResolvedValue(FULL);

    const response = await POST(
      request({
        username: "acme",
        repo: "demo",
        commit: FULL.slice(0, 7),
        github_pat: "ghp_caller",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveCommit).toHaveBeenCalledWith(
      "acme",
      "demo",
      FULL.slice(0, 7),
      "ghp_caller",
      expect.anything(),
    );
    expect(mocks.getDiagramStateRecord).toHaveBeenCalledWith(
      "acme",
      "demo",
      undefined,
      FULL,
    );
  });

  it("answers a malformed SHA with 400 and touches nothing", async () => {
    const response = await POST(
      request({ username: "acme", repo: "demo", commit: "main" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error_code: "COMMIT_SHA_INVALID",
    });
    expect(mocks.getDiagramStateRecord).not.toHaveBeenCalled();
    expect(mocks.resolveCommit).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "COMMIT_NOT_FOUND"],
    ["ambiguous", 422, "COMMIT_AMBIGUOUS"],
  ] as const)(
    "maps a %s short SHA to %i %s",
    async (failure, status, errorCode) => {
      mocks.resolveCommit.mockRejectedValue(new CommitResolutionError(failure));

      const response = await POST(
        request({ username: "acme", repo: "demo", commit: "deadbeef" }),
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({
        error_code: errorCode,
      });
      expect(mocks.getDiagramStateRecord).not.toHaveBeenCalled();
    },
  );

  it("tells a private repository without a token apart from a missing commit", async () => {
    mocks.resolveCommit.mockRejectedValue(
      new Error("A GitHub token is required to analyze a private repository."),
    );

    const response = await POST(
      request({ username: "acme", repo: "demo", commit: "deadbeef" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error_code: "GITHUB_AUTH_REQUIRED",
    });
  });

  it("rate limits short-SHA resolution, which spends GitHub requests", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 30,
    });

    const response = await POST(
      request({ username: "acme", repo: "demo", commit: "deadbeef" }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error_code: "RATE_LIMITED",
    });
    expect(mocks.resolveCommit).not.toHaveBeenCalled();
  });

  it("keeps an unrelated failure a generic 503", async () => {
    mocks.resolveCommit.mockRejectedValue(new Error("redis down"));

    const response = await POST(
      request({ username: "acme", repo: "demo", commit: "deadbeef" }),
    );

    expect(response.status).toBe(503);
  });
});
