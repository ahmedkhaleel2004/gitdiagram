import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagram } from "~/hooks/useDiagram";

const {
  getCachedDiagram,
  cacheDiagramAndExplanation,
  getLastGeneratedDate,
  getGenerationCost,
  repairGeneratedDiagram,
  getStoredOpenAiKey,
  storeOpenAiKey,
  useDiagramExport,
  runGeneration,
} = vi.hoisted(() => ({
  getCachedDiagram: vi.fn(),
  cacheDiagramAndExplanation: vi.fn(),
  getLastGeneratedDate: vi.fn(),
  getGenerationCost: vi.fn(),
  repairGeneratedDiagram: vi.fn(),
  getStoredOpenAiKey: vi.fn(),
  storeOpenAiKey: vi.fn(),
  useDiagramExport: vi.fn(),
  runGeneration: vi.fn(),
}));
let streamOptions:
  | {
      onComplete: (result: { diagram: string; explanation: string }) => Promise<void>;
      onError: (message: string) => void;
    }
  | undefined;

vi.mock("~/app/_actions/cache", () => ({
  getCachedDiagram,
  cacheDiagramAndExplanation,
}));

vi.mock("~/app/_actions/repo", () => ({
  getLastGeneratedDate,
}));

vi.mock("~/features/diagram/api", () => ({
  getGenerationCost,
  repairGeneratedDiagram,
}));

vi.mock("~/hooks/diagram/useDiagramStream", () => ({
  useDiagramStream: (options: typeof streamOptions) => {
    streamOptions = options;
    return {
      state: { status: "idle" },
      runGeneration,
      setState: vi.fn(),
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

    getCachedDiagram.mockResolvedValue(null);
    cacheDiagramAndExplanation.mockResolvedValue(undefined);
    getLastGeneratedDate.mockResolvedValue(new Date("2026-03-28T12:00:00.000Z"));
    getGenerationCost.mockResolvedValue({ cost: "$0.01" });
    repairGeneratedDiagram.mockResolvedValue({
      ok: true,
      diagram: "flowchart TD\nA-->C",
    });
    getStoredOpenAiKey.mockReturnValue(null);
    useDiagramExport.mockReturnValue({
      handleCopy: vi.fn(),
      handleExportImage: vi.fn(),
    });
    runGeneration.mockImplementation(async () => {
      await streamOptions?.onComplete({
        diagram: "flowchart TD\nA-->B",
        explanation: "done",
      });
    });
  });

  it("does not rerun the initial load effect after marking the free generation flag", async () => {
    const { result } = renderHook(() => useDiagram("acme", "demo"));

    await waitFor(() => expect(runGeneration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getCachedDiagram).toHaveBeenCalledTimes(1);
    expect(cacheDiagramAndExplanation).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("has_used_free_generation")).toBe("true");
  });

  it("repairs a completed diagram when client-side Mermaid rendering fails", async () => {
    const { result } = renderHook(() => useDiagram("acme", "demo"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.handleDiagramRenderError("Parse error on line 3");

    await waitFor(() =>
      expect(repairGeneratedDiagram).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "acme",
          repo: "demo",
          diagram: "flowchart TD\nA-->B",
          parserError: "Parse error on line 3",
        }),
      ),
    );
    await waitFor(() => expect(result.current.diagram).toBe("flowchart TD\nA-->C"));
    expect(cacheDiagramAndExplanation).toHaveBeenCalledTimes(2);
  });
});
