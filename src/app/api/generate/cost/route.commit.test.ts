// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  estimateCost: vi.fn(),
  getGithubData: vi.fn(),
  resolveRequestCredentials: vi.fn(),
  consumeInfrastructureRateLimit: vi.fn(),
}));

vi.mock("~/server/generate/rate-limit", () => ({
  consumeGenerationInfrastructureRateLimit:
    mocks.consumeInfrastructureRateLimit,
  getGenerationInfrastructureRateLimitMessage: vi.fn(
    () => "Too many repository requests.",
  ),
}));
vi.mock("~/server/generate/cost-estimate", () => ({
  estimateGenerationCost: mocks.estimateCost,
}));
vi.mock("~/server/generate/complimentary-gate", () => ({
  getComplimentaryModelMismatchMessage: vi.fn(() => "Model mismatch."),
  getComplimentaryProviderMismatchMessage: vi.fn(() => "Provider mismatch."),
  isComplimentaryGateEnabled: vi.fn(() => false),
  modelMatchesComplimentaryFamily: vi.fn(() => true),
}));
vi.mock("~/server/generate/github", () => ({
  getGithubData: mocks.getGithubData,
  REPOSITORY_TOO_LARGE_ERROR:
    "Repository is too large for analysis. Try a smaller repo.",
}));
vi.mock("~/server/generate/model-config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getModel: vi.fn(() => "gpt-5.6-terra"),
  getProvider: vi.fn(() => "openai"),
  shouldUseExactInputTokenCount: vi.fn(() => true),
}));
vi.mock("~/server/http/request-credentials", () => ({
  resolveRequestCredentials: mocks.resolveRequestCredentials,
}));

import { POST } from "~/app/api/generate/cost/route";
import { CommitResolutionError } from "~/server/generate/github-errors";

function request(body: Record<string, unknown>) {
  return new Request("https://gitdiagram.com/api/generate/cost", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gitdiagram.com",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ username: "openai", repo: "openai-node", ...body }),
  });
}

describe("POST /api/generate/cost with a commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.consumeInfrastructureRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      consumed: true,
    });
    mocks.resolveRequestCredentials.mockImplementation(
      async (
        _request: Request,
        { apiKey, githubPat }: { apiKey?: string; githubPat?: string },
      ) => ({ apiKey, githubPat }),
    );
    mocks.getGithubData.mockResolvedValue({
      defaultBranch: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      fileTree: "src/index.ts",
      pathTypes: new Map([["src/index.ts", "blob"]]),
      readme: "# OpenAI Node",
      isPrivate: false,
      stargazerCount: 10,
    });
    mocks.estimateCost.mockResolvedValue({
      costSummary: { display: "$0.0100 USD" },
      pricingModel: "gpt-5.6-terra",
      estimatedInputTokens: 100,
      estimatedOutputTokens: 200,
      pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
    });
  });

  it("estimates from the files at the commit", async () => {
    const response = await POST(request({ commit: "ABC1234" }));

    expect(response.status).toBe(200);
    expect(mocks.getGithubData).toHaveBeenCalledWith(
      "openai",
      "openai-node",
      undefined,
      expect.any(AbortSignal),
      { commit: "abc1234" },
    );
  });

  it("rejects a malformed commit before touching GitHub", async () => {
    const response = await POST(request({ commit: "main" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error_code: "COMMIT_SHA_INVALID",
    });
    expect(mocks.getGithubData).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "COMMIT_NOT_FOUND"],
    ["ambiguous", 422, "COMMIT_AMBIGUOUS"],
  ] as const)(
    "reports a %s commit as %i %s",
    async (failure, status, errorCode) => {
      mocks.getGithubData.mockRejectedValue(new CommitResolutionError(failure));

      const response = await POST(request({ commit: "deadbeef" }));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({
        error_code: errorCode,
      });
    },
  );
});
