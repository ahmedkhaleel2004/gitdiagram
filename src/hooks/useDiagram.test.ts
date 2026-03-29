import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagramStreamState } from "~/features/diagram/types";
import { useDiagram } from "~/hooks/useDiagram";

const {
  getDiagramState,
  persistDiagramRenderError,
  storeOpenAiKey,
  useDiagramExport,
  runGeneration,
  setStreamState,
} = vi.hoisted(() => ({
  getDiagramState: vi.fn(),
  persistDiagramRenderError: vi.fn(),
  storeOpenAiKey: vi.fn(),
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
  onComplete: (result: StreamCompletePayload) => Promise<void>;
  onError: (message: string) => void;
};

let streamOptions: StreamOptions | undefined;

vi.mock("~/app/_actions/cache", () => ({
  getDiagramState,
  persistDiagramRenderError,
}));

vi.mock("~/hooks/diagram/useDiagramStream", () => ({
  useDiagramStream: (options: StreamOptions) => {
    const [state, setState] = React.useState<DiagramStreamState>({
      status: "idle",
    });
    const trackedSetState = React.useCallback(
      (
        next:
          | DiagramStreamState
          | ((prev: DiagramStreamState) => DiagramStreamState),
      ) => {
        setStreamState(next);
        setState((prev) =>
          typeof next === "function" ? next(prev) : next,
        );
      },
      [setState],
    );
    streamOptions = {
      onError: options.onError,
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

vi.mock("~/lib/openai-key", () => ({
  storeOpenAiKey,
}));

describe("useDiagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    streamOptions = undefined;

    getDiagramState.mockResolvedValue({
      diagram: null,
      explanation: null,
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: null,
    });
    persistDiagramRenderError.mockResolvedValue(undefined);
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

  it("records browser render failures without re-entering LLM repair", async () => {
    const { result } = renderHook(() => useDiagram("acme", "demo"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.handleDiagramRenderError("Parse error on line 3");

    await waitFor(() =>
      expect(persistDiagramRenderError).toHaveBeenCalledWith(
        "acme",
        "demo",
        "Parse error on line 3",
        undefined,
      ),
    );
    await waitFor(() =>
      expect(result.current.error).toContain("Diagram render failed"),
    );
  });
});
