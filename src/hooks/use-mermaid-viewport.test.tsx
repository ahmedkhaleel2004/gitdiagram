import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupInteractiveViewport(bounds = CONTAINER_BOUNDS) {
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
  const layer = document.createElement("div");
  layer.getBoundingClientRect = () => bounds;
  result.current.interactionLayerRef.current = layer;

  act(() => {
    rerender({ renderVersion: 1 });
  });
  expect(result.current.isPanZoomReady).toBe(true);

  return { result, layer, diagramElement };
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
  it("uses the reading width for tall maps instead of squeezing labels into the viewport height", () => {
    const { rerender, result } = renderHook(
      ({ renderVersion }) =>
        useMermaidViewport({
          fitPadding: 0,
          fitToContainer: false,
          renderVersion,
          zoomingEnabled: false,
        }),
      { initialProps: { renderVersion: 0 } },
    );
    const container = document.createElement("div");
    container.getBoundingClientRect = () => CONTAINER_BOUNDS;
    const diagram = document.createElement("div");
    diagram.innerHTML =
      "<svg viewBox='0 0 1600 2240'><rect width='1600' height='2240' /></svg>";
    result.current.containerRef.current = container;
    result.current.interactionLayerRef.current = container;
    result.current.diagramRef.current = diagram;
    act(() => {
      rerender({ renderVersion: 1 });
    });
    const svg = diagram.querySelector("svg")!;
    expect(svg.style.width).toBe("1000px");
    expect(svg.style.height).toBe("1400px");
    expect(diagram.style.transform).toBe("");
  });
});

function readView(element: HTMLDivElement) {
  const match = /translate3d\((.*?)px, (.*?)px, 0(?:px)?\) scale\((.*?)\)/.exec(
    element.style.transform,
  )!;
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

function controlFrames() {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  return (time: number) =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(time));
    });
}

describe("viewport geometry and motion", () => {
  it("fits the actual inner canvas, excluding outer padding", () => {
    const { diagramElement } = setupInteractiveViewport({
      ...CONTAINER_BOUNDS,
      left: 20,
      top: 20,
      width: 800,
      height: 500,
    });
    const view = readView(diagramElement);
    expect(view.x).toBeCloseTo(174);
    expect(view.y).toBeCloseTo(24);
    expect(view.scale).toBeCloseTo(4.52);
  });
  it("interrupts a button animation at its displayed position when grabbed", () => {
    const frame = controlFrames();
    const { result, diagramElement } = setupInteractiveViewport();
    act(() => result.current.stepZoom(3));
    frame(0);
    frame(80);
    const midway = readView(diagramElement);
    expect(midway.scale).toBeGreaterThan(5.52);
    expect(midway.scale).toBeLessThan(5.52 * 3);
    act(() =>
      result.current.handlePointerDown(
        createTouchPointerEvent({ pointerId: 1, clientX: 300, clientY: 200 }),
      ),
    );
    frame(200);
    expect(readView(diagramElement)).toEqual(midway);
    act(() =>
      result.current.handlePointerMove(
        createTouchPointerEvent({ pointerId: 1, clientX: 320, clientY: 230 }),
      ),
    );
    frame(220);
    const after = readView(diagramElement);
    expect(after.scale).toBe(midway.scale);
    expect(after.x - midway.x).toBeCloseTo(20);
    expect(after.y - midway.y).toBeCloseTo(30);
  });
  it("applies toolbar changes immediately with reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { result, diagramElement } = setupInteractiveViewport();
    act(() => result.current.stepZoom(1.18));
    expect(readView(diagramElement).scale).toBeCloseTo(5.52 * 1.18);
    expect(result.current.formattedZoom).toBe("118%");
  });
  it("preserves the content at the center while resizing a zoomed canvas", () => {
    let resize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { result, layer, diagramElement } = setupInteractiveViewport();
    act(() => result.current.stepZoom(3));
    const before = readView(diagramElement);
    layer.getBoundingClientRect = () => ({
      ...CONTAINER_BOUNDS,
      width: 600,
      height: 400,
    });
    act(() => resize());
    const after = readView(diagramElement);
    expect(after.scale).toBe(before.scale);
    expect((300 - after.x) / after.scale).toBeCloseTo(
      (500 - before.x) / before.scale,
    );
    expect((200 - after.y) / after.scale).toBeCloseTo(
      (300 - before.y) / before.scale,
    );
  });
});
