import * as React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DiagramStreamHttpError } from "~/features/diagram/api";
import type { DiagramStreamState } from "~/features/diagram/types";
import { useDiagram } from "~/hooks/useDiagram";
import { isExampleRepo } from "~/lib/exampleRepos";

const {
  getCredentialStatus,
  getDiagramState,
  runGeneration,
  cancelGeneration,
  setStreamState,
  captureAnalyticsEvent,
} = vi.hoisted(() => ({
  getCredentialStatus: vi.fn(),
  getDiagramState: vi.fn(),
  runGeneration: vi.fn(),
  cancelGeneration: vi.fn(),
  setStreamState: vi.fn(),
  captureAnalyticsEvent: vi.fn(),
}));

vi.mock("~/lib/analytics-client", () => ({ captureAnalyticsEvent }));

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

vi.mock("~/features/diagram/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDiagramState,
}));
vi.mock("~/features/credentials/api", () => ({
  getCredentialStatus,
  migrateLegacyCredentialStorage: vi.fn(),
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
      cancelGeneration,
      setState: trackedSetState,
    };
  },
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

  it("surfaces a pre-stream rate-limit rejection verbatim when regenerating", async () => {
    const rateLimitMessage =
      "Too many free generations from this network. Please try again in about 12 minutes or use your own API key.";
    runGeneration.mockImplementationOnce(async () => {
      throw new DiagramStreamHttpError(rateLimitMessage, 429, "RATE_LIMITED");
    });

    const { result } = renderHook(() =>
      useDiagram(
        "acme",
        "demo",
        {
          diagram: "flowchart TD\nA-->B",
          explanation: "old diagram",
          graph: null,
          latestSessionAudit: null,
          lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
        },
        true,
      ),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleRegenerate();
    });

    expect(result.current.error).toBe(rateLimitMessage);
    expect(result.current.state.errorCode).toBe("RATE_LIMITED");
  });

  it("surfaces a pre-stream HTTP rejection verbatim during initial generation", async () => {
    const conflictMessage = "Generation session already exists. Please retry.";
    runGeneration.mockImplementationOnce(async () => {
      throw new DiagramStreamHttpError(
        conflictMessage,
        409,
        "SESSION_CONFLICT",
      );
    });

    const { result } = renderHook(() => useDiagram("acme", "demo"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(conflictMessage);
    expect(result.current.state.errorCode).toBe("SESSION_CONFLICT");
  });

  it("keeps the static fallback message for untyped generation failures", async () => {
    runGeneration.mockImplementationOnce(async () => {
      throw new Error("connection reset");
    });

    const { result } = renderHook(() =>
      useDiagram(
        "acme",
        "demo",
        {
          diagram: "flowchart TD\nA-->B",
          explanation: "old diagram",
          graph: null,
          latestSessionAudit: null,
          lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
        },
        true,
      ),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleRegenerate();
    });

    expect(result.current.error).toBe(
      "Something went wrong. Please try again later.",
    );
  });

  it("surfaces browser render failures without mutating shared state", async () => {
    const { result } = renderHook(() => useDiagram("acme", "demo"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.handleDiagramRenderError("Parse error on line 3");
    await waitFor(() =>
      expect(result.current.error).toContain("Diagram render failed"),
    );
  });
  it("stopping a pending cache lookup prevents a paid generation from starting", async () => {
    const pending = createDeferred<{
      diagram: null;
      explanation: null;
      graph: null;
      latestSessionAudit: null;
      lastSuccessfulAt: null;
    }>();
    getDiagramState.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useDiagram("acme", "demo"));
    expect(result.current.loading).toBe(true);
    act(() => result.current.handleCancel());
    expect(result.current.loading).toBe(false);
    expect(cancelGeneration).toHaveBeenCalledOnce();
    await act(async () =>
      pending.resolve({
        diagram: null,
        explanation: null,
        graph: null,
        latestSessionAudit: null,
        lastSuccessfulAt: null,
      }),
    );
    expect(runGeneration).not.toHaveBeenCalled();
  });
  it("allows recovery of a saved example after its lookup failed", async () => {
    getDiagramState.mockRejectedValueOnce(new Error("Connection interrupted"));
    const { result } = renderHook(() => useDiagram("pallets", "flask"));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    vi.mocked(isExampleRepo).mockReturnValueOnce(true);
    getDiagramState.mockResolvedValueOnce({
      diagram: "flowchart TD\nA-->B",
      explanation: "Saved analysis",
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: null,
    });
    await act(async () => result.current.handleRegenerate());
    expect(result.current.diagram).toContain("flowchart TD");
    expect(result.current.loading).toBe(false);
    expect(runGeneration).not.toHaveBeenCalled();
  });
});

describe("useDiagram analytics", () => {
  const storedDiagram = {
    diagram: "flowchart TD\nA-->B",
    explanation: "saved",
    graph: null,
    latestSessionAudit: null,
    lastSuccessfulAt: "2026-03-28T12:00:00.000Z",
  };
  const empty = {
    diagram: null,
    explanation: null,
    graph: null,
    latestSessionAudit: null,
    lastSuccessfulAt: null,
  };
  const events = (name: string) =>
    captureAnalyticsEvent.mock.calls
      .filter(([event]) => event === name)
      .map(([, properties]) => properties as Record<string, unknown>);

  function completeWith(outcome: Record<string, unknown>) {
    runGeneration.mockImplementationOnce(async () => {
      await streamOptions?.onComplete({
        diagram: "flowchart TD\nA-->B",
        explanation: "done",
        graph: undefined,
        latestSessionAudit: undefined,
      });
      return outcome;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    streamOptions = undefined;
    getCredentialStatus.mockResolvedValue({
      openaiApiKeyConfigured: false,
      githubPatConfigured: false,
    });
    getDiagramState.mockResolvedValue(empty);
    runGeneration.mockResolvedValue({ status: "aborted" });
  });

  it("reports a server-rendered diagram as viewed once", async () => {
    const { result, rerender } = renderHook(() =>
      useDiagram("acme", "demo", storedDiagram, true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();

    expect(events("diagram_viewed")).toEqual([
      { source: "stored", repo: "acme/demo", is_private: false },
    ]);
    expect(events("diagram_generation_started")).toEqual([]);
  });

  it("reports a private saved diagram without its name", async () => {
    getDiagramState.mockResolvedValueOnce({
      ...storedDiagram,
      visibility: "private",
    });
    const { result } = renderHook(() => useDiagram("acme", "secret"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(events("diagram_viewed")).toEqual([
      { source: "stored", repo: null, is_private: true },
    ]);
  });

  it("reports the start and success of a first generation", async () => {
    completeWith({
      status: "complete",
      usedOwnKey: true,
      visibility: "public",
    });
    const { result } = renderHook(() => useDiagram("acme", "demo"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The name is unknown until GitHub has confirmed the repository public.
    expect(events("diagram_generation_started")).toEqual([
      { repo: null, regenerate: false, trigger: "auto" },
    ]);
    expect(events("diagram_generated")).toEqual([
      {
        repo: "acme/demo",
        duration_ms: expect.any(Number),
        is_private: false,
        byok: true,
        regenerate: false,
        trigger: "auto",
      },
    ]);
    expect(events("diagram_failed")).toEqual([]);
  });

  it("never reports a private repository's name", async () => {
    completeWith({ status: "complete", visibility: "private" });
    const { result } = renderHook(() => useDiagram("acme", "secret"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(events("diagram_generated")).toEqual([
      expect.objectContaining({ repo: null, is_private: true, byok: false }),
    ]);
    act(() => result.current.handleDiagramRenderError("Parse error: secret"));
    expect(events("diagram_render_failed")).toEqual([
      {
        repo: null,
        is_private: true,
        source: "generated",
        stage: "browser_render",
        error_message: null,
      },
    ]);
  });

  it("reports a failure from the stream once, with its code and stage", async () => {
    runGeneration.mockResolvedValueOnce({
      status: "error",
      errorCode: "GITHUB_NOT_FOUND",
      failureStage: "started",
    });
    const { result } = renderHook(() => useDiagram("acme", "demo"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(events("diagram_failed")).toEqual([
      {
        repo: null,
        duration_ms: expect.any(Number),
        error_code: "GITHUB_NOT_FOUND",
        stage: "started",
        regenerate: false,
        trigger: "auto",
      },
    ]);
    expect(events("diagram_generated")).toEqual([]);
  });

  it("reports a rejected regeneration of a known public diagram", async () => {
    runGeneration.mockRejectedValueOnce(
      new DiagramStreamHttpError("Slow down", 429, "RATE_LIMITED"),
    );
    const { result } = renderHook(() =>
      useDiagram("acme", "demo", storedDiagram, true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.handleRegenerate();
    });

    expect(events("diagram_generation_started")).toEqual([
      { repo: "acme/demo", regenerate: true, trigger: "regenerate" },
    ]);
    expect(events("diagram_failed")).toEqual([
      expect.objectContaining({
        repo: "acme/demo",
        error_code: "RATE_LIMITED",
        stage: "request",
        regenerate: true,
      }),
    ]);
  });

  it("reports a stopped generation once", async () => {
    const pending = createDeferred<unknown>();
    runGeneration.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useDiagram("acme", "demo"));
    await waitFor(() => expect(runGeneration).toHaveBeenCalledOnce());
    act(() => result.current.handleCancel());
    await act(async () => pending.resolve({ status: "aborted" }));
    act(() => result.current.handleCancel());

    expect(events("diagram_failed")).toEqual([
      expect.objectContaining({
        error_code: "GENERATION_CANCELLED",
        stage: "cancelled",
      }),
    ]);
  });

  it("reports a saved-state lookup failure without a start", async () => {
    getDiagramState.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useDiagram("acme", "demo"));
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    expect(events("diagram_generation_started")).toEqual([]);
    expect(events("diagram_failed")).toEqual([
      expect.objectContaining({
        repo: null,
        error_code: "DIAGRAM_STATE_UNAVAILABLE",
        stage: "stored_state",
      }),
    ]);
  });

  it("reports a render failure once per diagram, with the message for public repos", async () => {
    const { result } = renderHook(() =>
      useDiagram("acme", "demo", storedDiagram, true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.handleDiagramRenderError("Parse error on line 3"));
    act(() => result.current.handleDiagramRenderError("Parse error on line 3"));

    expect(events("diagram_render_failed")).toEqual([
      {
        repo: "acme/demo",
        is_private: false,
        source: "stored",
        stage: "browser_render",
        error_message: "Parse error on line 3",
      },
    ]);
  });
});
