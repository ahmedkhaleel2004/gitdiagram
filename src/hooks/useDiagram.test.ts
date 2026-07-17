import * as React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagramStreamState } from "~/features/diagram/types";
import { useDiagram } from "~/hooks/useDiagram";

const {
  getCredentialStatus,
  getDiagramState,
  useDiagramExport,
  runGeneration,
  setStreamState,
} = vi.hoisted(() => ({
  getCredentialStatus: vi.fn(),
  getDiagramState: vi.fn(),
  useDiagramExport: vi.fn(),
  runGeneration: vi.fn(),
  setStreamState: vi.fn(),
}));

type StreamCompletePayload = {
  diagram: string;
  explanation: string;
  graph: DiagramStreamState["graph"];
  latestSessionAudit: DiagramStreamState["latestSessionAudit"];
  generatedAt?: string;
};

type StreamOptions = {
  initialState?: DiagramStreamState;
  onComplete: (result: StreamCompletePayload) => Promise<void>;
};

let streamOptions:
  (StreamOptions & { emitError: (message: string) => void }) | undefined;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

vi.mock("~/features/diagram/api", () => ({
  getDiagramState,
}));
vi.mock("~/features/credentials/api", () => ({
  getCredentialStatus,
}));

vi.mock("~/hooks/diagram/useDiagramStream", () => ({
  useDiagramStream: (options: StreamOptions) => {
    const [state, setState] = React.useState<DiagramStreamState>(
      options.initialState ?? {
        status: "idle",
      },
    );
    const trackedSetState = React.useCallback(
      (
        next:
          | DiagramStreamState
          | ((prev: DiagramStreamState) => DiagramStreamState),
      ) => {
        setStreamState(next);
        setState((prev) => (typeof next === "function" ? next(prev) : next));
      },
      [setState],
    );
    streamOptions = {
      emitError: (message: string) => {
        trackedSetState({
          status: "error",
          error: message,
          errorCode: "API_KEY_REQUIRED",
        });
      },
      onComplete: async (result: StreamCompletePayload) => {
        trackedSetState({
          status: "complete",
          diagram: result.diagram,
          explanation: result.explanation,
          graph: result.graph ?? undefined,
          latestSessionAudit: result.latestSessionAudit ?? undefined,
        });
        await options.onComplete(result);
      },
    };

    return {
      state,
      runGeneration,
      setState: trackedSetState,
    };
  },
}));

vi.mock("~/hooks/diagram/useDiagramExport", () => ({
  useDiagramExport: (...args: unknown[]) => useDiagramExport(...args),
}));

vi.mock("~/lib/exampleRepos", () => ({
  isExampleRepo: vi.fn(() => false),
}));

describe("useDiagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamOptions = undefined;

    getCredentialStatus.mockResolvedValue({
      openaiApiKeyConfigured: false,
      githubPatConfigured: false,
    });
    getDiagramState.mockResolvedValue({
      diagram: null,
      explanation: null,
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: null,
    });
    useDiagramExport.mockReturnValue({
      handleCopy: vi.fn(),
      handleExportImage: vi.fn(),
    });
    setStreamState.mockReset();
    runGeneration.mockImplementation(async () => {
      await streamOptions?.onComplete({
        diagram: "flowchart TD\nA-->B",
        explanation: "done",
        graph: {
          groups: [],
          nodes: [
            {
              id: "a",
              label: "A",
              type: "component",
              description: null,
              groupId: null,
              path: null,
              shape: null,
            },
          ],
          edges: [],
        },
        latestSessionAudit: undefined,
        generatedAt: "2026-03-28T12:00:00.000Z",
      });
    });
  });

  it("loads once and finishes after the initial generation completes", async () => {
    const { result } = renderHook(() => useDiagram("acme", "demo"));

    await waitFor(() => expect(runGeneration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getDiagramState).toHaveBeenCalledTimes(1);
    expect(result.current.diagram).toContain("flowchart TD");
  });

  it("renders an old diagram without surfacing a latest failed audit on refresh", async () => {
    const { result } = renderHook(() =>
      useDiagram("acme", "demo", {
        diagram: "flowchart TD\nA-->B",
        explanation: "old diagram",
        graph: null,
        lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
        latestSessionAudit: {
          sessionId: "failed-session",
          status: "failed",
          stage: "started",
          provider: "openai",
          model: "gpt-5.6-terra",
          stageUsages: [],
          graph: null,
          graphAttempts: [],
          timeline: [],
          createdAt: "2026-04-30T12:00:00.000Z",
          updatedAt: "2026-04-30T12:00:00.000Z",
          failureStage: "started",
          validationError:
            "File tree and README combined exceeds token limit (50,000).",
        },
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(runGeneration).not.toHaveBeenCalled();
    expect(result.current.diagram).toContain("flowchart TD");
    expect(result.current.error).toBe("");
  });

  it("syncs a cached initial diagram with the latest stored artifact", async () => {
    getDiagramState.mockResolvedValueOnce({
      diagram: "flowchart TD\nA-->C",
      explanation: "new diagram",
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
    });

    const { result } = renderHook(() =>
      useDiagram("acme", "demo", {
        diagram: "flowchart TD\nA-->B",
        explanation: "old diagram",
        graph: null,
        latestSessionAudit: null,
        lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
      }),
    );

    await waitFor(() => expect(result.current.diagram).toContain("A-->C"));

    expect(getDiagramState).toHaveBeenCalledWith("acme", "demo");
    expect(runGeneration).not.toHaveBeenCalled();
    expect(result.current.lastGenerated?.toISOString()).toBe(
      "2026-03-29T12:00:00.000Z",
    );
  });

  it("does not download authoritative public initial state twice", async () => {
    const { result } = renderHook(() =>
      useDiagram(
        "acme",
        "demo",
        {
          diagram: "flowchart TD\nA-->B",
          explanation: "server diagram",
          graph: null,
          latestSessionAudit: null,
          lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
        },
        true,
      ),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.diagram).toContain("A-->B");
    expect(getDiagramState).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("still checks private state when a PAT exists", async () => {
    getCredentialStatus.mockResolvedValueOnce({
      openaiApiKeyConfigured: false,
      githubPatConfigured: true,
    });
    getDiagramState.mockResolvedValueOnce({
      diagram: "flowchart TD\nA-->PRIVATE",
      explanation: "private diagram",
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
    });

    const { result } = renderHook(() =>
      useDiagram(
        "acme",
        "demo",
        {
          diagram: "flowchart TD\nA-->PUBLIC",
          explanation: "public diagram",
          graph: null,
          latestSessionAudit: null,
          lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
        },
        true,
      ),
    );

    await waitFor(() => expect(result.current.diagram).toContain("PRIVATE"));

    expect(getDiagramState).toHaveBeenCalledWith("acme", "demo");
  });

  it("keeps a foreground regeneration authoritative when credential status resolves later", async () => {
    const credentialStatus = createDeferred<{
      githubPatConfigured: boolean;
      openaiApiKeyConfigured: boolean;
    }>();
    const generation = createDeferred<void>();
    getCredentialStatus.mockReturnValueOnce(credentialStatus.promise);
    getDiagramState.mockResolvedValueOnce({
      diagram: "flowchart TD\nA-->STORED",
      explanation: "stored diagram",
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
    });
    runGeneration.mockImplementationOnce(async () => {
      await generation.promise;
      await streamOptions?.onComplete({
        diagram: "flowchart TD\nA-->GENERATED",
        explanation: "fresh generation",
        graph: undefined,
        latestSessionAudit: undefined,
        generatedAt: "2026-03-29T12:00:00.000Z",
      });
    });

    const { result } = renderHook(() =>
      useDiagram(
        "acme",
        "demo",
        {
          diagram: "flowchart TD\nA-->INITIAL",
          explanation: "initial diagram",
          graph: null,
          latestSessionAudit: null,
          lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
        },
        true,
      ),
    );

    let regeneration!: Promise<void>;
    act(() => {
      regeneration = result.current.handleRegenerate();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      credentialStatus.resolve({
        githubPatConfigured: true,
        openaiApiKeyConfigured: false,
      });
      await credentialStatus.promise;
    });

    expect(getDiagramState).not.toHaveBeenCalled();
    expect(result.current.diagram).toContain("A-->INITIAL");

    await act(async () => {
      generation.resolve();
      await regeneration;
    });

    expect(result.current.diagram).toContain("A-->GENERATED");
    expect(result.current.loading).toBe(false);
  });

  it("shows an over-limit error from the current regenerate attempt", async () => {
    runGeneration.mockImplementationOnce(async () => {
      streamOptions?.emitError(
        "File tree and README combined exceeds token limit (100,000). This repository is too large for free generation. Provide your own OpenAI API key to continue.",
      );
    });

    const { result } = renderHook(() =>
      useDiagram("acme", "demo", {
        diagram: "flowchart TD\nA-->B",
        explanation: "old diagram",
        graph: null,
        latestSessionAudit: null,
        lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.handleRegenerate();

    await waitFor(() => expect(result.current.error).toContain("100,000"));
    expect(result.current.error).toContain("API key");
  });

  it("keeps loading while a newer regeneration is still active", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondRun = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    runGeneration
      .mockReset()
      .mockImplementationOnce(() => firstRun)
      .mockImplementationOnce(() => secondRun);

    const { result } = renderHook(() =>
      useDiagram(
        "acme",
        "demo",
        {
          diagram: "flowchart TD\nA-->B",
          explanation: "server diagram",
          graph: null,
          latestSessionAudit: null,
          lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
        },
        true,
      ),
    );

    let firstOperation!: Promise<void>;
    act(() => {
      firstOperation = result.current.handleRegenerate();
    });
    await waitFor(() => expect(runGeneration).toHaveBeenCalledTimes(1));

    let secondOperation!: Promise<void>;
    act(() => {
      secondOperation = result.current.handleRegenerate();
    });
    await waitFor(() => expect(runGeneration).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirst();
      await firstOperation;
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveSecond();
      await secondOperation;
    });
    expect(result.current.loading).toBe(false);
  });

  it("surfaces browser render failures without mutating shared state", async () => {
    const { result } = renderHook(() => useDiagram("acme", "demo"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.handleDiagramRenderError("Parse error on line 3");
    await waitFor(() =>
      expect(result.current.error).toContain("Diagram render failed"),
    );
  });
});
