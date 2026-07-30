import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";

import { useMermaidViewport } from "~/hooks/use-mermaid-viewport";

const CONTAINER_BOUNDS = {
  bottom: 600,
  height: 600,
  left: 0,
  right: 1000,
  top: 0,
  width: 1000,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function createTouchPointerEvent({
  clientX,
  clientY,
  pointerId,
}: {
  clientX: number;
  clientY: number;
  pointerId: number;
}) {
  const target = document.createElement("div");
  const currentTarget = document.createElement("div");
  currentTarget.setPointerCapture = vi.fn();
  currentTarget.hasPointerCapture = vi.fn().mockReturnValue(false);
  currentTarget.releasePointerCapture = vi.fn();

  return {
    button: 0,
    clientX,
    clientY,
    currentTarget,
    pointerId,
    pointerType: "touch",
    preventDefault: vi.fn(),
    target,
  } as unknown as ReactPointerEvent<HTMLDivElement>;
}

function setupInteractiveViewport() {
  const { rerender, result } = renderHook(
    ({ renderVersion }: { renderVersion: number }) =>
      useMermaidViewport({
        fitPadding: 24,
        fitToContainer: false,
        renderVersion,
        zoomingEnabled: true,
      }),
    { initialProps: { renderVersion: 0 } },
  );

  const containerElement = document.createElement("div");
  containerElement.getBoundingClientRect = () => CONTAINER_BOUNDS;
  const diagramElement = document.createElement("div");
  diagramElement.innerHTML =
    "<svg viewBox='0 0 100 100'><rect width='100' height='100' /></svg>";

  result.current.containerRef.current = containerElement;
  result.current.diagramRef.current = diagramElement;

  act(() => {
    rerender({ renderVersion: 1 });
  });
  expect(result.current.isPanZoomReady).toBe(true);

  return { result };
}

describe("useMermaidViewport", () => {
  it("keeps panning with the remaining finger after a pinch ends", () => {
    const { result } = setupInteractiveViewport();

    act(() => {
      result.current.handlePointerDown(
        createTouchPointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
      );
      result.current.handlePointerDown(
        createTouchPointerEvent({ clientX: 200, clientY: 200, pointerId: 2 }),
      );
      result.current.handlePointerUp(
        createTouchPointerEvent({ clientX: 200, clientY: 200, pointerId: 2 }),
      );
    });

    const moveEvent = createTouchPointerEvent({
      clientX: 130,
      clientY: 120,
      pointerId: 1,
    });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    expect(moveEvent.preventDefault).toHaveBeenCalled();
  });

  it("stops panning once the last finger lifts after a pinch", () => {
    const { result } = setupInteractiveViewport();

    act(() => {
      result.current.handlePointerDown(
        createTouchPointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
      );
      result.current.handlePointerDown(
        createTouchPointerEvent({ clientX: 200, clientY: 200, pointerId: 2 }),
      );
      result.current.handlePointerUp(
        createTouchPointerEvent({ clientX: 200, clientY: 200, pointerId: 2 }),
      );
      result.current.handlePointerUp(
        createTouchPointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
      );
    });

    const moveEvent = createTouchPointerEvent({
      clientX: 130,
      clientY: 120,
      pointerId: 1,
    });
    act(() => {
      result.current.handlePointerMove(moveEvent);
    });

    expect(moveEvent.preventDefault).not.toHaveBeenCalled();
  });
});
