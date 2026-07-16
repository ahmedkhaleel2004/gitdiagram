import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStream } from "~/hooks/diagram/useDiagramStream";

const { streamDiagramGenerationMock } = vi.hoisted(() => ({
  streamDiagramGenerationMock: vi.fn(),
}));

vi.mock("~/features/diagram/api", () => ({
  streamDiagramGeneration: streamDiagramGenerationMock,
}));

describe("useDiagramStream", () => {
  beforeEach(() => {
    streamDiagramGenerationMock.mockReset();
    streamDiagramGenerationMock.mockImplementation(
      async (_params, handlers) => {
        await handlers.onMessage({
          status: "started",
          message: "starting",
          cost_summary: {
            kind: "estimate",
            approximate: true,
            amountUsd: 0.0123,
            display: "$0.0123 USD",
            pricingModel: "gpt-5.6-terra",
            usage: {
              inputTokens: 1000,
              outputTokens: 2000,
              totalTokens: 3000,
            },
          },
        });
        await handlers.onMessage({
          status: "explanation_chunk",
          chunk: "Repo details",
        });
        await handlers.onMessage({
          status: "complete",
          cost_summary: {
            kind: "actual",
            approximate: false,
            amountUsd: 0.009,
            display: "$0.0090 USD",
            pricingModel: "gpt-5.6-terra",
            usage: {
              inputTokens: 900,
              outputTokens: 1800,
              totalTokens: 2700,
            },
          },
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
        });
      },
    );
  });

  it("updates state through stream lifecycle", async () => {
    const onComplete = vi.fn(async () => undefined);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useDiagramStream({
        username: "acme",
        repo: "demo",
        onComplete,
        onError,
      }),
    );

    await act(async () => {
      await result.current.runGeneration();
    });

    expect(result.current.state.status).toBe("complete");
    expect(result.current.state.diagram).toContain("flowchart TD");
    expect(result.current.state.graph?.nodes).toHaveLength(1);
    expect(result.current.state.costSummary?.kind).toBe("actual");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("commits multiple explanation chunks at most once per frame", async () => {
    let frameCallback: FrameRequestCallback | null = null;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallback = callback;
        return 42;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );

    streamDiagramGenerationMock.mockImplementationOnce(
      async (_params, handlers) => {
        await handlers.onMessage({ status: "explanation_chunk", chunk: "A" });
        await handlers.onMessage({ status: "explanation_chunk", chunk: "B" });
        await handlers.onMessage({ status: "explanation_chunk", chunk: "C" });
      },
    );

    const { result } = renderHook(() =>
      useDiagramStream({
        username: "acme",
        repo: "demo",
        onComplete: vi.fn(async () => undefined),
        onError: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.runGeneration();
    });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(result.current.state.explanation).toBeUndefined();

    act(() => {
      frameCallback?.(0);
    });

    expect(result.current.state.explanation).toBe("ABC");
  });
});
