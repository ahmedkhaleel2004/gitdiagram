import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDiagramWheelGestures } from "./use-diagram-wheel-gestures";

afterEach(cleanup);

function setup(enabled = true) {
  const layer = document.createElement("div");
  const panBy = vi.fn();
  const zoomAroundPoint = vi.fn();
  const hasActivePointers = vi.fn(() => false);
  const { unmount } = renderHook(() =>
    useDiagramWheelGestures({
      enabled,
      layerRef: { current: layer },
      onStart: vi.fn(),
      hasActivePointers,
      panBy,
      zoomAroundPoint,
    }),
  );
  const wheel = (deltaY: number, time: number, extra: WheelEventInit = {}) => {
    const event = new WheelEvent("wheel", {
      deltaY,
      cancelable: true,
      clientX: 240,
      clientY: 180,
      ...extra,
    });
    Object.defineProperty(event, "timeStamp", { value: time });
    act(() => {
      layer.dispatchEvent(event);
    });
    return event;
  };
  const gesture = (name: string, scale = 1) => {
    const event = new Event(name, { cancelable: true });
    Object.assign(event, { scale, clientX: 240, clientY: 180 });
    act(() => {
      layer.dispatchEvent(event);
    });
  };
  return { panBy, zoomAroundPoint, wheel, gesture, hasActivePointers, unmount };
}

describe("diagram wheel gestures", () => {
  it("keeps accelerated trackpad scrolling and its momentum in pan mode", () => {
    const { wheel, panBy, zoomAroundPoint } = setup();
    wheel(12, 0);
    wheel(80, 16);
    wheel(120, 32);
    wheel(4, 48);
    expect(panBy.mock.calls).toEqual([
      [-0, -12],
      [-0, -80],
      [-0, -120],
      [-0, -4],
    ]);
    expect(zoomAroundPoint).not.toHaveBeenCalled();
  });
  it("keeps a mouse wheel burst in zoom mode and reclassifies after an idle gap", () => {
    const { wheel, panBy, zoomAroundPoint } = setup();
    wheel(100, 0);
    wheel(30, 16);
    expect(zoomAroundPoint).toHaveBeenCalledTimes(2);
    wheel(8, 400);
    expect(panBy).toHaveBeenCalledWith(-0, -8);
  });
  it("recognizes fractional pixel trackpad deltas even at high speed", () => {
    const { wheel, panBy, zoomAroundPoint } = setup();
    wheel(85.5, 0);
    expect(panBy).toHaveBeenCalledWith(-0, -85.5);
    expect(zoomAroundPoint).not.toHaveBeenCalled();
  });
  it("always handles ctrl-pinch as zoom during a trackpad scroll", () => {
    const { wheel, zoomAroundPoint } = setup();
    wheel(8, 0);
    wheel(-8, 16, { ctrlKey: true });
    expect(zoomAroundPoint).toHaveBeenCalledWith(expect.any(Number), 240, 180);
  });
  it("normalizes Firefox line wheel events", () => {
    const { wheel, zoomAroundPoint } = setup();
    wheel(-3, 0, { deltaMode: 1 });
    expect(zoomAroundPoint.mock.calls[0]?.[0]).toBeCloseTo(
      Math.exp(48 * 0.0015),
    );
  });
  it("uses Safari gesture ratios without applying duplicate wheel events", () => {
    const { gesture, wheel, zoomAroundPoint } = setup();
    gesture("gesturestart");
    gesture("gesturechange", 1.2);
    wheel(-8, 0, { ctrlKey: true });
    gesture("gesturechange", 1.5);
    gesture("gestureend");
    expect(zoomAroundPoint.mock.calls).toEqual([
      [1.2, 240, 180],
      [1.25, 240, 180],
    ]);
    wheel(-8, 300, { ctrlKey: true });
    expect(zoomAroundPoint).toHaveBeenCalledTimes(3);
  });
  it("does not double-apply Safari touch gestures already handled by pointers", () => {
    const { gesture, hasActivePointers, zoomAroundPoint } = setup();
    hasActivePointers.mockReturnValue(true);
    gesture("gesturestart");
    gesture("gesturechange", 2);
    expect(zoomAroundPoint).not.toHaveBeenCalled();
  });
  it("preserves native scrolling when disabled and after unmount", () => {
    const disabled = setup(false);
    expect(disabled.wheel(80, 0).defaultPrevented).toBe(false);
    const active = setup();
    expect(active.wheel(80, 0).defaultPrevented).toBe(true);
    active.unmount();
    expect(active.wheel(80, 16).defaultPrevented).toBe(false);
  });
});
