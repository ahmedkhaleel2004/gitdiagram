import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagram } from "~/hooks/useDiagram";

const {
  getDiagramState,
  persistDiagramRenderError,
  getGenerationCost,
  getStoredOpenAiKey,
  storeOpenAiKey,
  useDiagramExport,
  runGeneration,
  setStreamState,
} = vi.hoisted(() => ({
  getDiagramState: vi.fn(),
  persistDiagramRenderError: vi.fn(),
  getGenerationCost: vi.fn(),
  getStoredOpenAiKey: vi.fn(),
  storeOpenAiKey: vi.fn(),
  useDiagramExport: vi.fn(),
  runGeneration: vi.fn(),
  setStreamState: vi.fn(),
}));

let streamOptions:
  | {
      onComplete: (result: {
        diagram: string;
        explanation: string;
        graph: unknown;
        latestSessionAudit: unknown;
        generatedAt?: string;
      }) => Promise<void>;
      onError: (message: string) => void;
    }
  | undefined;

vi.mock("~/app/_actions/cache", () => ({
  getDiagramState,
  persistDiagramRenderError,
}));

vi.mock("~/features/diagram/api", () => ({
  getGenerationCost,
}));

vi.mock("~/hooks/diagram/useDiagramStream", () => ({
  useDiagramStream: (options: typeof streamOptions) => {
    streamOptions = options;
    return {
      state: { status: "idle" },
      runGeneration,
      setState: setStreamState,
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
  getStoredOpenAiKey,
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
    getGenerationCost.mockResolvedValue({ cost: "$0.01" });
    getStoredOpenAiKey.mockReturnValue(null);
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
        latestSessionAudit: null,
        generatedAt: "2026-03-28T12:00:00.000Z",
      });
    });
  });

  it("does not rerun the initial load effect after marking the free generation flag", async () => {
    const { result } = renderHook(() => useDiagram("acme", "demo"));

    await waitFor(() => expect(runGeneration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getDiagramState).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("has_used_free_generation")).toBe("true");
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
      ),
    );
    await waitFor(() =>
      expect(result.current.error).toContain("Diagram render failed"),
    );
  });
});
