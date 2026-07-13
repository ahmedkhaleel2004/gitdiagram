// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  estimateCost: vi.fn(),
  getGithubData: vi.fn(),
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
    "Repository is too large (>195k tokens) for analysis. Try a smaller repo.",
}));
vi.mock("~/server/generate/model-config", () => ({
  getModel: vi.fn(() => "gpt-5.6-terra"),
  getProvider: vi.fn(() => "openai"),
  shouldUseExactInputTokenCount: vi.fn(() => true),
}));

import { POST } from "~/app/api/generate/cost/route";

function request() {
  return new Request("https://gitdiagram.com/api/generate/cost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "openai", repo: "openai-node" }),
  });
}

describe("POST /api/generate/cost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGithubData.mockResolvedValue({
      defaultBranch: "main",
      fileTree: "src/index.ts",
      readme: "# OpenAI Node",
      isPrivate: false,
      stargazerCount: 10,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the route deadline abort to a 504 response", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    mocks.estimateCost.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );

    const responsePromise = POST(request());
    deadline.abort(new DOMException("Cost deadline exceeded", "TimeoutError"));
    const response = await responsePromise;

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Cost estimation timed out. Please retry.",
      error_code: "GENERATION_TIMEOUT",
    });
  });
});
