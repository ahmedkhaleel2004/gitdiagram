"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";
import {
  getWheelZoomScaleFactor,
  isLikelyTrackpadGesture,
} from "~/components/mermaid-diagram-helpers";

type SafariGestureEvent = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

export function useDiagramWheelGestures({
  enabled,
  layerRef,
  onStart,
  hasActivePointers,
  panBy,
  zoomAroundPoint,
}: {
  enabled: boolean;
  layerRef: RefObject<HTMLDivElement | null>;
  onStart: () => void;
  hasActivePointers: () => boolean;
  panBy: (x: number, y: number) => void;
  zoomAroundPoint: (factor: number, x: number, y: number) => void;
}) {
  const handlePan = useEffectEvent(panBy);
  const handleZoom = useEffectEvent(zoomAroundPoint);
  const start = useEffectEvent(onStart);
  const isPointerGesture = useEffectEvent(hasActivePointers);

  useEffect(() => {
    const layer = layerRef.current;
    if (!enabled || !layer) return;
    let wheelMode: "pan" | "zoom" | null = null;
    let lastWheelTime = -Infinity;
    let gestureScale: number | null = null;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaX === 0 && event.deltaY === 0) return;
      event.preventDefault();
      if (gestureScale !== null) return;
      start();
      if (event.ctrlKey || event.metaKey) {
        handleZoom(
          getWheelZoomScaleFactor(event),
          event.clientX,
          event.clientY,
        );
        return;
      }
      // Acceleration and momentum must not turn one scroll into two gestures.
      if (!wheelMode || event.timeStamp - lastWheelTime > 180) {
        wheelMode = isLikelyTrackpadGesture(event) ? "pan" : "zoom";
      }
      lastWheelTime = event.timeStamp;
      if (wheelMode === "pan") handlePan(-event.deltaX, -event.deltaY);
      else
        handleZoom(
          getWheelZoomScaleFactor(event),
          event.clientX,
          event.clientY,
        );
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      if (isPointerGesture()) return;
      start();
      gestureScale = 1;
    };
    const onGestureChange = (event: Event) => {
      if (gestureScale === null) return;
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      const bounds = layer.getBoundingClientRect();
      handleZoom(
        gesture.scale / gestureScale,
        Number.isFinite(gesture.clientX)
          ? gesture.clientX
          : bounds.left + bounds.width / 2,
        Number.isFinite(gesture.clientY)
          ? gesture.clientY
          : bounds.top + bounds.height / 2,
      );
      gestureScale = gesture.scale;
    };
    const reset = () => {
      gestureScale = null;
      wheelMode = null;
      lastWheelTime = -Infinity;
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      reset();
    };
    layer.addEventListener("wheel", onWheel, { passive: false });
    layer.addEventListener("gesturestart", onGestureStart, { passive: false });
    layer.addEventListener("gesturechange", onGestureChange, {
      passive: false,
    });
    layer.addEventListener("gestureend", onGestureEnd);
    window.addEventListener("blur", reset);
    return () => {
      layer.removeEventListener("wheel", onWheel);
      layer.removeEventListener("gesturestart", onGestureStart);
      layer.removeEventListener("gesturechange", onGestureChange);
      layer.removeEventListener("gestureend", onGestureEnd);
      window.removeEventListener("blur", reset);
    };
  }, [enabled, layerRef]);
}
