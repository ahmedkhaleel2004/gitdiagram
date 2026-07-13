// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  admitQuota: vi.fn(),
  estimateCost: vi.fn(),
  finalizeQuota: vi.fn(),
  getGithubData: vi.fn(),
  persistAudit: vi.fn(),
  saveDiagram: vi.fn(),
  streamCompletion: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("~/app/browse/data", () => ({ revalidateBrowseIndexCache: vi.fn() }));
vi.mock("~/server/storage/diagram-state", () => ({
  persistTerminalSessionAudit: mocks.persistAudit,
  saveSuccessfulDiagramState: mocks.saveDiagram,
  updatePublicBrowseIndexForSuccessfulDiagram: vi.fn(),
}));
vi.mock("~/server/generate/complimentary-gate", () => ({
  admitComplimentaryQuota: mocks.admitQuota,
  buildComplimentaryAdmissionTokens: vi.fn(() => 10_000),
  finalizeComplimentaryQuota: mocks.finalizeQuota,
  getComplimentaryDenialMessage: vi.fn(() => "Daily limit reached."),
  getComplimentaryModelMismatchMessage: vi.fn(() => "Model mismatch."),
  getComplimentaryProviderMismatchMessage: vi.fn(() => "Provider mismatch."),
  isComplimentaryGateEnabled: vi.fn(() => true),
  modelMatchesComplimentaryFamily: vi.fn(() => true),
  shouldApplyComplimentaryGate: vi.fn(() => true),
}));
vi.mock("~/server/generate/cost-estimate", () => ({
  estimateGenerationCost: mocks.estimateCost,
}));
vi.mock("~/server/generate/github", () => ({
  getGithubData: mocks.getGithubData,
  REPOSITORY_TOO_LARGE_ERROR:
    "Repository is too large (>195k tokens) for analysis. Try a smaller repo.",
}));
vi.mock("~/server/generate/model-config", () => ({
  getModel: vi.fn(() => "gpt-5.6-terra"),
  getProvider: vi.fn(() => "openai"),
  getProviderLabel: vi.fn(() => "OpenAI"),
  shouldUseExactInputTokenCount: vi.fn(() => true),
}));
vi.mock("~/server/generate/openai", () => ({
  generateStructuredOutput: vi.fn(),
  streamCompletion: mocks.streamCompletion,
}));
vi.mock("~/server/generate/mermaid", () => ({
  validateMermaidSyntax: vi.fn(),
}));

import { POST } from "~/app/api/generate/stream/route";

const estimateCostSummary = {
  kind: "estimate" as const,
  approximate: true,
  amountUsd: 0.01,
  display: "$0.0100 USD",
  pricingModel: "gpt-5.6-terra",
  usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
};

function request() {
  return new Request("https://gitdiagram.com/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "openai", repo: "openai-node" }),
  });
}

function mockEstimate(explanationInputTokens: number) {
  mocks.estimateCost.mockResolvedValue({
    costSummary: estimateCostSummary,
    estimatedInputTokens: explanationInputTokens,
    estimatedOutputTokens: 200,
    pricingModel: "gpt-5.6-terra",
    pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 },
    explanationInputTokens,
    graphStaticInputTokens: 100,
    graphRepairStaticInputTokens: 100,
  });
}

describe("POST /api/generate/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getGithubData.mockResolvedValue({
      defaultBranch: "main",
      fileTree: "src/index.ts",
      readme: "# OpenAI Node",
      isPrivate: false,
      stargazerCount: 10,
    });
    mocks.persistAudit.mockResolvedValue(undefined);
    mocks.finalizeQuota.mockResolvedValue(undefined);
  });

  it("rejects an oversized repository before reserving complimentary quota", async () => {
    mockEstimate(200_000);

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-generation-session-id")).toBeTruthy();
    expect(body).toContain('"error_code":"TOKEN_LIMIT_EXCEEDED"');
    expect(mocks.admitQuota).not.toHaveBeenCalled();
    expect(mocks.streamCompletion).not.toHaveBeenCalled();
  });

  it("finalizes a conservative quota amount before closing a failed stream", async () => {
    mockEstimate(100);
    mocks.admitQuota.mockResolvedValue({
      admitted: true,
      reservation: {
        quotaBucket: "daily",
        quotaDateUtc: "2026-07-13",
        quotaResetAt: "2026-07-14T00:00:00.000Z",
        reservedTokens: 10_000,
      },
    });
    mocks.streamCompletion.mockRejectedValue(new Error("Provider unavailable"));

    const response = await POST(request());
    const body = await response.text();

    expect(mocks.finalizeQuota).toHaveBeenCalledWith(
      expect.objectContaining({ committedTokens: 10_000 }),
    );
    expect(mocks.persistAudit).toHaveBeenCalledTimes(1);
    expect(mocks.persistAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.objectContaining({
          quotaStatus: "finalized",
          actualCommittedTokens: 10_000,
        }),
      }),
    );
    expect(body).toContain('"error_code":"STREAM_FAILED"');
    expect(body).toContain('"actualCommittedTokens":10000');
  });
});
