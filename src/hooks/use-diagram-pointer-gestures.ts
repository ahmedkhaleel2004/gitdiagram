"use client";

import {
  useCallback,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  getDistanceBetweenPointers,
  getPinchScaleFactor,
  getPointerMidpoint,
  getTrackedPointerPair,
  type PinchState,
  type PointerCoordinates,
  type ViewState,
} from "~/components/mermaid-diagram-helpers";

interface PointerGestureOptions {
  enabled: boolean;
  layerRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<ViewState | null>;
  onStart: () => void;
  onEnd: () => void;
  panBy: (x: number, y: number) => void;
  pinchTo: (
    view: ViewState,
    startX: number,
    startY: number,
    x: number,
    y: number,
    factor: number,
  ) => ViewState | null;
}

export function useDiagramPointerGestures({
  enabled,
  layerRef,
  viewRef,
  onStart,
  onEnd,
  panBy,
  pinchTo,
}: PointerGestureOptions) {
  const pointers = useRef(new Map<number, PointerCoordinates>());
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const pinch = useRef<PinchState | null>(null);
  const suppressClick = useRef(false);

  const rebase = useCallback(() => {
    const pair = getTrackedPointerPair(pointers.current);
    const view = viewRef.current;
    pinch.current = null;
    drag.current = null;
    if (pair && view) {
      const midpoint = getPointerMidpoint(...pair);
      pinch.current = {
        startDistance: getDistanceBetweenPointers(...pair),
        startView: view,
        startX: midpoint.x,
        startY: midpoint.y,
      };
      suppressClick.current = true;
    } else {
      const remaining = pointers.current.entries().next().value;
      if (remaining) {
        const [id, point] = remaining;
        drag.current = { id, ...point, active: suppressClick.current };
      }
    }
    if (layerRef.current)
      layerRef.current.dataset.dragging = String(
        suppressClick.current && pointers.current.size > 0,
      );
  }, [layerRef, viewRef]);

  const resetInteractionState = useCallback(() => {
    const ids = [...pointers.current.keys()];
    pointers.current.clear();
    drag.current = null;
    pinch.current = null;
    const layer = layerRef.current;
    if (layer) {
      layer.dataset.dragging = "false";
      for (const id of ids) {
        if (layer.hasPointerCapture?.(id)) layer.releasePointerCapture(id);
      }
    }
  }, [layerRef]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled || (event.pointerType !== "touch" && event.button !== 0))
        return;
      if (
        !(event.target instanceof Element) ||
        event.target.closest("[data-diagram-toolbar]")
      )
        return;
      if (pointers.current.size === 0) suppressClick.current = false;
      onStart();
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      rebase();
      // Keep ordinary node taps/clicks native. Capture only once a drag wins.
      if (pointers.current.size >= 2) event.preventDefault();
    },
    [enabled, onStart, rebase],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!pointers.current.delete(event.pointerId)) return;
      rebase();
      onEnd();
      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [onEnd, rebase],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(event.pointerId)) return;
      if (event.pointerType !== "touch" && event.buttons === 0) {
        handlePointerUp(event);
        return;
      }
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const pair = getTrackedPointerPair(pointers.current);
      if (pinch.current && pair) {
        event.preventDefault();
        const midpoint = getPointerMidpoint(...pair);
        const distance = getDistanceBetweenPointers(...pair);
        const start = pinch.current;
        if (distance > 0 && start.startDistance > 0) {
          const view = pinchTo(
            start.startView,
            start.startX,
            start.startY,
            midpoint.x,
            midpoint.y,
            getPinchScaleFactor(start.startDistance, distance),
          );
          if (view)
            pinch.current = {
              startView: view,
              startDistance: distance,
              startX: midpoint.x,
              startY: midpoint.y,
            };
        } else {
          rebase();
        }
        return;
      }
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (
        !current.active &&
        Math.hypot(dx, dy) < (event.pointerType === "touch" ? 6 : 4)
      )
        return;
      event.preventDefault();
      suppressClick.current = true;
      event.currentTarget.dataset.dragging = "true";
      if (!event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.setPointerCapture?.(event.pointerId);
      panBy(dx, dy);
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        active: true,
      };
    },
    [handlePointerUp, panBy, pinchTo, rebase],
  );

  const handleLostPointerCapture = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // Ignore capture transferred from a child to the canvas at drag start.
      if (event.target === event.currentTarget) handlePointerUp(event);
    },
    [handlePointerUp],
  );

  const handleClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (
        enabled &&
        suppressClick.current &&
        event.detail !== 0 &&
        !(
          event.target instanceof Element &&
          event.target.closest("[data-diagram-toolbar]")
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [enabled],
  );

  const hasActivePointers = useCallback(() => pointers.current.size > 0, []);

  return {
    hasActivePointers,
    handleClickCapture,
    handleLostPointerCapture,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    resetInteractionState,
  };
}
