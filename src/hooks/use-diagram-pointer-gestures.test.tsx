import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent, PointerEvent } from "react";
import { useDiagramPointerGestures } from "./use-diagram-pointer-gestures";

afterEach(cleanup);
function setup() {
  const layer = document.createElement("div");
  layer.setPointerCapture = vi.fn();
  layer.hasPointerCapture = vi.fn(() => false);
  layer.releasePointerCapture = vi.fn();
  const panBy = vi.fn();
  const view = {
    x: -300,
    y: -200,
    width: 1000,
    height: 800,
    scale: 2,
    fitScale: 1,
  };
  const pinchTo = vi.fn<
    Parameters<typeof useDiagramPointerGestures>[0]["pinchTo"]
  >(() => view);
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      useDiagramPointerGestures({
        enabled,
        layerRef: { current: layer },
        viewRef: { current: view },
        onStart: vi.fn(),
        onEnd: vi.fn(),
        panBy,
        pinchTo,
      }),
    { initialProps: { enabled: true } },
  );
  const pointer = (
    type: "Down" | "Move" | "Up",
    id: number,
    x: number,
    y: number,
    target: Element = layer,
    pointerType = "mouse",
    buttons = 1,
  ) => {
    const event = {
      pointerId: id,
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
      pointerType,
      currentTarget: layer,
      target,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent<HTMLDivElement>;
    act(() => result.current[`handlePointer${type}`](event));
    return event;
  };
  const click = (detail = 1) => {
    const event = {
      detail,
      target: layer,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent<HTMLDivElement>;
    result.current.handleClickCapture(event);
    return event;
  };
  return { result, layer, panBy, pinchTo, pointer, click, rerender };
}

describe("diagram pointer gestures", () => {
  it("drags from empty canvas space and suppresses the release click", () => {
    const { pointer, panBy, click } = setup();
    pointer("Down", 1, 10, 10);
    pointer("Move", 1, 50, 25);
    pointer("Up", 1, 50, 25);
    expect(panBy).toHaveBeenCalledWith(40, 15);
    expect(click().preventDefault).toHaveBeenCalled();
  });
  it("preserves node taps with hand jitter but lets a drag start from a linked node", () => {
    const { pointer, panBy, click } = setup();
    const node = document.createElement("a");
    node.className = "clickable";
    pointer("Down", 1, 10, 10, node);
    pointer("Move", 1, 12, 11, node);
    pointer("Up", 1, 12, 11, node);
    expect(panBy).not.toHaveBeenCalled();
    expect(click().preventDefault).not.toHaveBeenCalled();
    pointer("Down", 1, 10, 10, node);
    pointer("Move", 1, 30, 20, node);
    pointer("Up", 1, 30, 20, node);
    expect(panBy).toHaveBeenCalledWith(20, 10);
    expect(click().preventDefault).toHaveBeenCalled();
    expect(click(0).preventDefault).not.toHaveBeenCalled();
    pointer("Down", 1, 10, 10, node);
    pointer("Up", 1, 10, 10, node);
    expect(click().preventDefault).not.toHaveBeenCalled();
  });
  it("does not start a drag from the toolbar or its zoom label", () => {
    const { pointer, panBy } = setup();
    const toolbar = document.createElement("div");
    toolbar.dataset.diagramToolbar = "";
    const label = toolbar.appendChild(document.createElement("span"));
    pointer("Down", 1, 10, 10, label);
    pointer("Move", 1, 50, 20, label);
    expect(panBy).not.toHaveBeenCalled();
  });
  it("rebases a pinch when one of three fingers leaves without a scale jump", () => {
    const { pointer, pinchTo } = setup();
    pointer("Down", 1, 100, 100, undefined, "touch");
    pointer("Down", 2, 200, 100, undefined, "touch");
    pointer("Down", 3, 300, 100, undefined, "touch");
    pointer("Up", 1, 100, 100, undefined, "touch");
    pointer("Move", 3, 310, 100, undefined, "touch");
    expect(pinchTo.mock.calls[0]?.[5]).toBeCloseTo(1.1);
  });
  it("stops a mouse drag when its button was released outside the window", () => {
    const { pointer, panBy, result } = setup();
    pointer("Down", 1, 10, 10);
    pointer("Move", 1, 50, 20, undefined, "mouse", 0);
    expect(panBy).not.toHaveBeenCalled();
    expect(result.current.hasActivePointers()).toBe(false);
  });
  it("clears active pointers and captures when the interaction is interrupted", () => {
    const { pointer, panBy, result, layer } = setup();
    pointer("Down", 1, 10, 10);
    pointer("Move", 1, 50, 20);
    vi.mocked(layer.hasPointerCapture).mockReturnValue(true);
    act(() => result.current.resetInteractionState());
    expect(layer.releasePointerCapture).toHaveBeenCalledWith(1);
    panBy.mockClear();
    pointer("Move", 1, 100, 100);
    expect(panBy).not.toHaveBeenCalled();
  });
});

it("preserves read-only links after exiting zoom during a drag", () => {
  const { pointer, click, rerender } = setup();
  pointer("Down", 1, 10, 10);
  pointer("Move", 1, 50, 20);
  pointer("Up", 1, 50, 20);
  expect(click().preventDefault).toHaveBeenCalled();
  rerender({ enabled: false });
  expect(click().preventDefault).not.toHaveBeenCalled();
});
