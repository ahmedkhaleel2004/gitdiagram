// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  admitQuota: vi.fn(),
  buildStageTokenBound: vi.fn(),
  clearFailureSummary: vi.fn(),
  estimateCost: vi.fn(),
  finalizeQuota: vi.fn(),
  generateStructuredOutput: vi.fn(),
  getGithubData: vi.fn(),
  persistAudit: vi.fn(),
  registerActiveGeneration: vi.fn(),
  resolveRequestCredentials: vi.fn(),
  saveDiagram: vi.fn(),
  startCancellationPolling: vi.fn(),
  stopCancellationPolling: vi.fn(),
  streamCompletion: vi.fn(),
  unregisterActiveGeneration: vi.fn(),
  writePublicPreview: vi.fn(),
  afterCallback: undefined as undefined | (() => Promise<void>),
  cancellationCallback: undefined as undefined | (() => void),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("~/server/browse-index-cache", () => ({
  revalidateBrowseIndexCache: vi.fn(),
}));
vi.mock("~/server/storage/artifact-store", () => ({
  writePublicDiagramPreview: mocks.writePublicPreview,
}));
vi.mock("~/server/storage/diagram-state", () => ({
  clearSuccessfulDiagramFailureSummary: mocks.clearFailureSummary,
  persistTerminalSessionAudit: mocks.persistAudit,
  saveSuccessfulDiagramState: mocks.saveDiagram,
  updatePublicBrowseIndexForSuccessfulDiagram: vi.fn(),
}));
vi.mock("~/server/generate/complimentary-gate", () => ({
  admitComplimentaryQuota: mocks.admitQuota,
  buildComplimentaryAdmissionTokens: vi.fn(() => 10_000),
  buildComplimentaryStageTokenBound: mocks.buildStageTokenBound,
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
vi.mock("~/server/generate/cancellation", () => ({
  registerActiveGeneration: mocks.registerActiveGeneration,
  startGenerationCancellationPolling: mocks.startCancellationPolling,
  unregisterActiveGeneration: mocks.unregisterActiveGeneration,
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
  generateStructuredOutput: mocks.generateStructuredOutput,
  streamCompletion: mocks.streamCompletion,
}));
vi.mock("~/server/http/request-credentials", () => ({
  resolveRequestCredentials: mocks.resolveRequestCredentials,
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

function request(body: Record<string, unknown> = {}) {
  return new Request("https://gitdiagram.com/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "openai", repo: "openai-node", ...body }),
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

function readSseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n\n")
    .filter((message) => message.startsWith("data: "))
    .map((message) => JSON.parse(message.slice(6)) as Record<string, unknown>);
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
    mocks.clearFailureSummary.mockResolvedValue(undefined);
    mocks.saveDiagram.mockResolvedValue(true);
    mocks.finalizeQuota.mockResolvedValue(undefined);
    mocks.afterCallback = undefined;
    mocks.after.mockImplementation((callback: () => Promise<void>) => {
      mocks.afterCallback = callback;
    });
    mocks.buildStageTokenBound.mockImplementation(
      (
        estimate: {
          explanationInputTokens: number;
          graphStaticInputTokens: number;
          graphRepairStaticInputTokens: number;
        },
        stage: { stage: "explanation" } | { stage: "graph"; attempt: number },
      ) => {
        if (stage.stage === "explanation") {
          return estimate.explanationInputTokens + 6_000;
        }
        return stage.attempt === 1
          ? estimate.graphStaticInputTokens + 12_000
          : estimate.graphRepairStaticInputTokens + 20_000;
      },
    );
    mocks.registerActiveGeneration.mockResolvedValue(true);
    mocks.resolveRequestCredentials.mockImplementation(
      async (
        _request: Request,
        explicit: { apiKey?: string; githubPat?: string },
      ) => explicit,
    );
    mocks.unregisterActiveGeneration.mockResolvedValue(undefined);
    mocks.writePublicPreview.mockResolvedValue(true);
    mocks.cancellationCallback = undefined;
    mocks.startCancellationPolling.mockImplementation(
      ({ onCancelled }: { onCancelled: () => void }) => {
        mocks.cancellationCallback = onCancelled;
        return mocks.stopCancellationPolling;
      },
    );
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

  it("uses same-origin stored credentials resolved at the request boundary", async () => {
    mockEstimate(200_000);
    mocks.resolveRequestCredentials.mockResolvedValueOnce({
      apiKey: "stored-openai-key",
      githubPat: "stored-github-pat",
    });
    const generationRequest = request();

    const response = await POST(generationRequest);
    await response.text();

    expect(mocks.resolveRequestCredentials).toHaveBeenCalledWith(
      generationRequest,
      { apiKey: undefined, githubPat: undefined },
    );
    expect(mocks.getGithubData).toHaveBeenCalledWith(
      "openai",
      "openai-node",
      "stored-github-pat",
      expect.any(AbortSignal),
    );
    expect(mocks.estimateCost).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "stored-openai-key" }),
    );
  });

  it("commits only the in-flight stage bound before closing a failed stream", async () => {
    mockEstimate(100);
    mocks.admitQuota.mockResolvedValue({
      admitted: true,
      reservation: {
        reservationId: "reservation-1",
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
      expect.objectContaining({ committedTokens: 6_100 }),
    );
    expect(mocks.persistAudit).toHaveBeenCalledTimes(1);
    expect(mocks.persistAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.objectContaining({
          quotaStatus: "finalized",
          actualCommittedTokens: 6_100,
        }),
      }),
    );
    expect(body).toContain('"error_code":"STREAM_FAILED"');
    expect(body).toContain('"actualCommittedTokens":6100');
  });

  it("aborts shared generation work when distributed cancellation is observed", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const cancelToken = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    mocks.getGithubData.mockImplementation(
      (
        _username: string,
        _repo: string,
        _githubPat: string | undefined,
        signal: AbortSignal,
      ) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          queueMicrotask(() => mocks.cancellationCallback?.());
        }),
    );

    const response = await POST(
      request({ session_id: sessionId, cancel_token: cancelToken }),
    );
    const body = await response.text();
    await mocks.afterCallback?.();

    expect(response.headers.get("x-generation-session-id")).toBe(sessionId);
    expect(mocks.registerActiveGeneration).toHaveBeenCalledWith(
      sessionId,
      cancelToken,
    );
    expect(mocks.startCancellationPolling).toHaveBeenCalledWith({
      sessionId,
      onCancelled: expect.any(Function),
    });
    expect(mocks.stopCancellationPolling).toHaveBeenCalledTimes(1);
    expect(mocks.unregisterActiveGeneration).toHaveBeenCalledWith(
      sessionId,
      cancelToken,
    );
    expect(mocks.streamCompletion).not.toHaveBeenCalled();
    expect(mocks.persistAudit).not.toHaveBeenCalled();
    expect(body).not.toContain('"status":"error"');
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"outcome":"cancelled"'),
    );
  });

  it("commits the explanation-stage bound when cancelled mid-request", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const cancelToken = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    mockEstimate(100);
    mocks.admitQuota.mockResolvedValue({
      admitted: true,
      reservation: {
        reservationId: "reservation-1",
        quotaBucket: "daily",
        quotaDateUtc: "2026-07-13",
        quotaResetAt: "2026-07-14T00:00:00.000Z",
        reservedTokens: 30_000,
      },
    });
    mocks.streamCompletion.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => ({
        stream: (async function* () {
          queueMicrotask(() => mocks.cancellationCallback?.());
          await new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
          yield "";
        })(),
        usagePromise: Promise.resolve(null),
      }),
    );

    const response = await POST(
      request({ session_id: sessionId, cancel_token: cancelToken }),
    );
    await response.text();

    expect(mocks.finalizeQuota).toHaveBeenCalledWith(
      expect.objectContaining({ committedTokens: 6_100 }),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"outcome":"cancelled"'),
    );
  });

  it("adds only the current graph bound after measured explanation usage", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const cancelToken = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    mockEstimate(100);
    mocks.admitQuota.mockResolvedValue({
      admitted: true,
      reservation: {
        reservationId: "reservation-1",
        quotaBucket: "daily",
        quotaDateUtc: "2026-07-13",
        quotaResetAt: "2026-07-14T00:00:00.000Z",
        reservedTokens: 30_000,
      },
    });
    const explanationUsage = {
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
    };
    mocks.streamCompletion.mockResolvedValue({
      stream: (async function* () {
        yield "<explanation>Measured explanation.</explanation>";
      })(),
      usagePromise: Promise.resolve(explanationUsage),
    });
    mocks.generateStructuredOutput.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          queueMicrotask(() => mocks.cancellationCallback?.());
        }),
    );

    const response = await POST(
      request({ session_id: sessionId, cancel_token: cancelToken }),
    );
    await response.text();

    expect(mocks.finalizeQuota).toHaveBeenCalledWith(
      expect.objectContaining({ committedTokens: 12_200 }),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"outcome":"cancelled"'),
    );
  });

  it("fails closed when cancellation registration is unavailable", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const cancelToken = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    mocks.registerActiveGeneration.mockRejectedValueOnce(
      new Error("secret Upstash failure"),
    );

    const response = await POST(
      request({ session_id: sessionId, cancel_token: cancelToken }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error_code: "CANCELLATION_UNAVAILABLE",
    });
    expect(mocks.getGithubData).not.toHaveBeenCalled();
    expect(mocks.startCancellationPolling).not.toHaveBeenCalled();
  });

  it("sends a slim success audit without duplicating result bodies", async () => {
    mockEstimate(100);
    mocks.admitQuota.mockResolvedValue({
      admitted: true,
      reservation: {
        reservationId: "reservation-1",
        quotaBucket: "daily",
        quotaDateUtc: "2026-07-13",
        quotaResetAt: "2026-07-14T00:00:00.000Z",
        reservedTokens: 10_000,
      },
    });
    const usage = {
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
      cachedInputTokens: 40,
      reasoningTokens: 10,
    };
    mocks.streamCompletion.mockResolvedValue({
      stream: (async function* () {
        yield "<explanation>Hello-world request flow.</explanation>";
      })(),
      usagePromise: Promise.resolve(usage),
    });
    const graph = {
      groups: [],
      nodes: [
        {
          id: "entrypoint",
          label: "Entry point",
          type: "TypeScript module",
          description: null,
          groupId: null,
          path: "src/index.ts",
          shape: "box",
        },
      ],
      edges: [],
    };
    mocks.generateStructuredOutput.mockResolvedValue({
      output: graph,
      rawText: JSON.stringify(graph),
      usage,
    });

    const response = await POST(request());
    const events = readSseEvents(await response.text());
    const terminal = events.find((event) => event.status === "complete");
    const terminalAudit = terminal?.latest_session_audit as
      Record<string, unknown> | undefined;

    expect(terminal).toMatchObject({
      status: "complete",
      explanation: "Hello-world request flow.",
      graph,
    });
    expect(terminal?.diagram).toEqual(expect.stringContaining("flowchart TD"));
    expect(terminal).not.toHaveProperty("graph_attempts");
    expect(terminalAudit).toMatchObject({
      status: "succeeded",
      quotaStatus: "finalized",
      actualCommittedTokens: 200,
      graph: null,
      graphAttempts: [],
      stageUsages: [],
      timeline: [],
    });
    expect(terminalAudit).not.toHaveProperty("explanation");
    expect(terminalAudit).not.toHaveProperty("compiledDiagram");
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"cached_input_tokens":80'),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"reasoning_tokens":20'),
    );
    expect(mocks.clearFailureSummary).not.toHaveBeenCalled();
    await mocks.afterCallback?.();
    expect(mocks.clearFailureSummary).toHaveBeenCalledWith({
      username: "openai",
      repo: "openai-node",
      githubPat: undefined,
      visibility: "public",
    });
    expect(mocks.writePublicPreview).toHaveBeenCalledWith({
      username: "openai",
      repo: "openai-node",
      diagram: expect.stringContaining("flowchart TD"),
      lastSuccessfulAt: expect.any(String),
    });
  });

  it("coalesces explanation deltas without changing their bytes or order", async () => {
    mockEstimate(100);
    mocks.admitQuota.mockResolvedValue({
      admitted: true,
      reservation: {
        reservationId: "reservation-1",
        quotaBucket: "daily",
        quotaDateUtc: "2026-07-13",
        quotaResetAt: "2026-07-14T00:00:00.000Z",
        reservedTokens: 10_000,
      },
    });
    const usage = { inputTokens: 80, outputTokens: 20, totalTokens: 100 };
    const sourceChunks = [
      "<explanation>",
      "Hello",
      " ",
      "streaming",
      " world.",
      "</explanation>",
    ];
    mocks.streamCompletion.mockResolvedValue({
      stream: (async function* () {
        yield* sourceChunks;
      })(),
      usagePromise: Promise.resolve(usage),
    });
    const graph = {
      groups: [],
      nodes: [
        {
          id: "entrypoint",
          label: "Entry point",
          type: "TypeScript module",
          description: null,
          groupId: null,
          path: "src/index.ts",
          shape: "box",
        },
      ],
      edges: [],
    };
    mocks.generateStructuredOutput.mockResolvedValue({
      output: graph,
      rawText: JSON.stringify(graph),
      usage,
    });

    const response = await POST(request());
    const events = readSseEvents(await response.text());
    const explanationChunks = events
      .filter((event) => event.status === "explanation_chunk")
      .map((event) => event.chunk as string);

    expect(explanationChunks.join("")).toBe(sourceChunks.join(""));
    expect(explanationChunks.length).toBeLessThan(sourceChunks.length);
    expect(events.at(-1)).toMatchObject({
      status: "complete",
      explanation: "Hello streaming world.",
    });
  });

  it("logs sanitized validation categories for successful retry sessions", async () => {
    mockEstimate(100);
    mocks.admitQuota.mockResolvedValue({
      admitted: true,
      reservation: {
        reservationId: "reservation-1",
        quotaBucket: "daily",
        quotaDateUtc: "2026-07-13",
        quotaResetAt: "2026-07-14T00:00:00.000Z",
        reservedTokens: 50_000,
      },
    });
    const usage = { inputTokens: 80, outputTokens: 20, totalTokens: 100 };
    mocks.streamCompletion.mockResolvedValue({
      stream: (async function* () {
        yield "<explanation>Retry diagnostics.</explanation>";
      })(),
      usagePromise: Promise.resolve(usage),
    });
    const invalidGraph = {
      groups: [],
      nodes: [
        {
          id: "entrypoint",
          label: "Entry point",
          type: "TypeScript module",
          description: null,
          groupId: null,
          path: "src/private-name.ts",
          shape: "box",
        },
      ],
      edges: [],
    };
    const validGraph = {
      ...invalidGraph,
      nodes: [{ ...invalidGraph.nodes[0], path: "src/index.ts" }],
    };
    mocks.generateStructuredOutput
      .mockResolvedValueOnce({
        output: invalidGraph,
        rawText: JSON.stringify(invalidGraph),
        usage,
      })
      .mockResolvedValueOnce({
        output: validGraph,
        rawText: JSON.stringify(validGraph),
        usage,
      });

    const response = await POST(request());
    await response.text();
    const finishLog = vi
      .mocked(console.info)
      .mock.calls.map(([value]) => String(value))
      .find((value) => value.includes('"event":"generate.stream.finished"'));
    const finishEvent = JSON.parse(finishLog ?? "{}") as Record<
      string,
      unknown
    >;

    expect(finishEvent.graph_validation_categories).toEqual({
      missing_repository_path: 1,
    });
    expect(finishLog).not.toContain("private-name");
  });
});
