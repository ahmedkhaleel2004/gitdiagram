"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  clampViewState,
  getDefaultDiagramScale,
  getDistanceBetweenPointers,
  getPinchScaleFactor,
  getPointerMidpoint,
  getSvgDimensions,
  getTrackedPointerPair,
  getWheelZoomScaleFactor,
  isLikelyTrackpadGesture,
  type PinchState,
  type PointerCoordinates,
  type ViewState,
} from "~/components/mermaid-diagram-helpers";

const ZOOM_LABEL_UPDATE_INTERVAL_MS = 100;

interface UseMermaidViewportOptions {
  fitPadding: number;
  fitToContainer: boolean;
  onRenderComplete?: () => void;
  renderVersion: number;
  zoomingEnabled: boolean;
}

function formatZoom(viewState: ViewState | null) {
  if (!viewState) return "100%";
  return `${Math.round((viewState.scale / viewState.fitScale) * 100)}%`;
}

function applyViewState(
  diagramElement: HTMLDivElement | null,
  viewState: ViewState | null,
) {
  if (!diagramElement) return;

  if (!viewState) {
    diagramElement.style.removeProperty("left");
    diagramElement.style.removeProperty("position");
    diagramElement.style.removeProperty("top");
    diagramElement.style.removeProperty("transform");
    diagramElement.style.removeProperty("transform-origin");
    return;
  }

  diagramElement.style.left = "0";
  diagramElement.style.position = "absolute";
  diagramElement.style.top = "0";
  diagramElement.style.transform = `translate3d(${viewState.x}px, ${viewState.y}px, 0) scale(${viewState.scale})`;
  diagramElement.style.transformOrigin = "0 0";
}

export function useMermaidViewport({
  fitPadding,
  fitToContainer,
  onRenderComplete,
  renderVersion,
  zoomingEnabled,
}: UseMermaidViewportOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const interactionLayerRef = useRef<HTMLDivElement>(null);
  const activePointersRef = useRef<Map<number, PointerCoordinates>>(new Map());
  const dragStateRef = useRef<{
    lastX: number;
    lastY: number;
    pointerId: number;
  } | null>(null);
  const pinchStateRef = useRef<PinchState | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const viewStateRef = useRef<ViewState | null>(null);
  const viewStateFrameRef = useRef<number | null>(null);
  const pendingZoomLabelRef = useRef<ViewState | null>(null);
  const zoomLabelTimeoutRef = useRef<number | null>(null);
  const lastZoomLabelUpdateRef = useRef(0);
  const userInteractedRef = useRef(false);
  const completedRenderVersionRef = useRef(0);
  const [formattedZoom, setFormattedZoom] = useState("100%");
  const [isPanZoomReady, setIsPanZoomReady] = useState(false);

  const reportRenderComplete = useEffectEvent(() => {
    onRenderComplete?.();
  });

  const updateZoomLabel = useCallback((nextView: ViewState | null) => {
    lastZoomLabelUpdateRef.current = Date.now();
    setFormattedZoom((currentZoom) => {
      const nextZoom = formatZoom(nextView);
      return currentZoom === nextZoom ? currentZoom : nextZoom;
    });
  }, []);

  const cancelPendingZoomLabel = useCallback(() => {
    if (zoomLabelTimeoutRef.current !== null) {
      window.clearTimeout(zoomLabelTimeoutRef.current);
      zoomLabelTimeoutRef.current = null;
    }
    pendingZoomLabelRef.current = null;
  }, []);

  const flushPendingZoomLabel = useCallback(() => {
    if (zoomLabelTimeoutRef.current !== null) {
      window.clearTimeout(zoomLabelTimeoutRef.current);
      zoomLabelTimeoutRef.current = null;
    }

    const pendingView = pendingZoomLabelRef.current;
    pendingZoomLabelRef.current = null;
    if (pendingView) {
      updateZoomLabel(pendingView);
    }
  }, [updateZoomLabel]);

  const scheduleZoomLabel = useCallback(
    (nextView: ViewState) => {
      pendingZoomLabelRef.current = nextView;
      if (zoomLabelTimeoutRef.current !== null) return;

      const elapsed = Date.now() - lastZoomLabelUpdateRef.current;
      if (elapsed >= ZOOM_LABEL_UPDATE_INTERVAL_MS) {
        flushPendingZoomLabel();
        return;
      }

      zoomLabelTimeoutRef.current = window.setTimeout(
        flushPendingZoomLabel,
        ZOOM_LABEL_UPDATE_INTERVAL_MS - elapsed,
      );
    },
    [flushPendingZoomLabel],
  );

  const cancelViewStateFrame = useCallback(() => {
    if (viewStateFrameRef.current === null) return;
    cancelAnimationFrame(viewStateFrameRef.current);
    viewStateFrameRef.current = null;
  }, []);

  const commitViewState = useCallback(
    (nextView: ViewState | null) => {
      cancelViewStateFrame();
      cancelPendingZoomLabel();
      viewStateRef.current = nextView;
      applyViewState(diagramRef.current, nextView);
      updateZoomLabel(nextView);
    },
    [cancelPendingZoomLabel, cancelViewStateFrame, updateZoomLabel],
  );

  const scheduleViewState = useCallback(
    (nextView: ViewState, updateLabel = false) => {
      viewStateRef.current = nextView;
      if (updateLabel) {
        scheduleZoomLabel(nextView);
      }
      if (viewStateFrameRef.current !== null) return;

      viewStateFrameRef.current = requestAnimationFrame(() => {
        viewStateFrameRef.current = null;
        applyViewState(diagramRef.current, viewStateRef.current);
      });
    },
    [scheduleZoomLabel],
  );

  const disconnectResizeObserver = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  const resetInteractionState = useCallback(() => {
    activePointersRef.current.clear();
    dragStateRef.current = null;
    pinchStateRef.current = null;
  }, []);

  const prepareForRender = useCallback(() => {
    setIsPanZoomReady(false);
    disconnectResizeObserver();
    resetInteractionState();
    userInteractedRef.current = false;
    commitViewState(null);
  }, [commitViewState, disconnectResizeObserver, resetInteractionState]);

  const fitDiagram = useCallback(() => {
    const containerElement = containerRef.current;
    const svgElement = diagramRef.current?.querySelector("svg");
    if (!(containerElement instanceof HTMLDivElement)) return;
    if (!(svgElement instanceof SVGSVGElement)) return;

    const bounds = containerElement.getBoundingClientRect();
    const { height, width } = getSvgDimensions(svgElement);
    const insetX = Math.min(fitPadding, Math.max((bounds.width - 1) / 2, 0));
    const insetY = Math.min(fitPadding, Math.max((bounds.height - 1) / 2, 0));
    const availableWidth = Math.max(bounds.width - insetX * 2, 1);
    const availableHeight = Math.max(bounds.height - insetY * 2, 1);
    const fitScale = Math.min(availableWidth / width, availableHeight / height);
    const scale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;

    userInteractedRef.current = false;
    commitViewState({
      fitScale: scale,
      height,
      scale,
      width,
      x: insetX + (availableWidth - width * scale) / 2,
      y: insetY + (availableHeight - height * scale) / 2,
    });
  }, [commitViewState, fitPadding]);

  const scaleDiagramForReading = useCallback(() => {
    const containerElement = containerRef.current;
    const svgElement = diagramRef.current?.querySelector("svg");
    if (!(containerElement instanceof HTMLDivElement)) return;
    if (!(svgElement instanceof SVGSVGElement)) return;

    const { height, width } = getSvgDimensions(svgElement);
    const scale = getDefaultDiagramScale({
      containerWidth: containerElement.getBoundingClientRect().width,
      contentHeight: height,
      contentWidth: width,
      viewportHeight: window.innerHeight,
    });

    svgElement.style.width = `${width * scale}px`;
    svgElement.style.height = `${height * scale}px`;
  }, []);

  const zoomAroundPoint = useCallback(
    (
      scaleFactor: number,
      clientX: number,
      clientY: number,
      updateLabelImmediately = false,
    ) => {
      const currentView = viewStateRef.current;
      const containerElement = containerRef.current;
      if (!currentView || !(containerElement instanceof HTMLDivElement)) return;

      const bounds = containerElement.getBoundingClientRect();
      const localX = clientX - bounds.left;
      const localY = clientY - bounds.top;
      const minScale = currentView.fitScale * 0.6;
      const maxScale = currentView.fitScale * 12;
      const nextScale = Math.min(
        maxScale,
        Math.max(minScale, currentView.scale * scaleFactor),
      );
      const contentX = (localX - currentView.x) / currentView.scale;
      const contentY = (localY - currentView.y) / currentView.scale;
      const clamped = clampViewState({
        containerHeight: bounds.height,
        containerWidth: bounds.width,
        contentHeight: currentView.height,
        contentWidth: currentView.width,
        nextScale,
        nextX: localX - contentX * nextScale,
        nextY: localY - contentY * nextScale,
      });
      const nextView = {
        ...currentView,
        scale: nextScale,
        x: clamped.x,
        y: clamped.y,
      };

      userInteractedRef.current = true;
      if (updateLabelImmediately) {
        commitViewState(nextView);
      } else {
        scheduleViewState(nextView, true);
      }
    },
    [commitViewState, scheduleViewState],
  );

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const currentView = viewStateRef.current;
      const containerElement = containerRef.current;
      if (!currentView || !(containerElement instanceof HTMLDivElement)) return;

      const bounds = containerElement.getBoundingClientRect();
      const clamped = clampViewState({
        containerHeight: bounds.height,
        containerWidth: bounds.width,
        contentHeight: currentView.height,
        contentWidth: currentView.width,
        nextScale: currentView.scale,
        nextX: currentView.x + deltaX,
        nextY: currentView.y + deltaY,
      });

      userInteractedRef.current = true;
      scheduleViewState({
        ...currentView,
        x: clamped.x,
        y: clamped.y,
      });
    },
    [scheduleViewState],
  );

  const pinchTo = useCallback(
    (
      baseView: ViewState,
      startClientX: number,
      startClientY: number,
      clientX: number,
      clientY: number,
      scaleFactor: number,
    ) => {
      const containerElement = containerRef.current;
      if (!(containerElement instanceof HTMLDivElement)) return null;

      const bounds = containerElement.getBoundingClientRect();
      const localStartX = startClientX - bounds.left;
      const localStartY = startClientY - bounds.top;
      const localX = clientX - bounds.left;
      const localY = clientY - bounds.top;
      const minScale = baseView.fitScale * 0.6;
      const maxScale = baseView.fitScale * 12;
      const nextScale = Math.min(
        maxScale,
        Math.max(minScale, baseView.scale * scaleFactor),
      );
      const contentX = (localStartX - baseView.x) / baseView.scale;
      const contentY = (localStartY - baseView.y) / baseView.scale;
      const clamped = clampViewState({
        containerHeight: bounds.height,
        containerWidth: bounds.width,
        contentHeight: baseView.height,
        contentWidth: baseView.width,
        nextScale,
        nextX: localX - contentX * nextScale,
        nextY: localY - contentY * nextScale,
      });
      const nextView = {
        ...baseView,
        scale: nextScale,
        x: clamped.x,
        y: clamped.y,
      };

      userInteractedRef.current = true;
      scheduleViewState(nextView, true);
      return nextView;
    },
    [scheduleViewState],
  );

  const stepZoom = useCallback(
    (scaleFactor: number) => {
      const containerElement = containerRef.current;
      if (!(containerElement instanceof HTMLDivElement)) return;

      const bounds = containerElement.getBoundingClientRect();
      zoomAroundPoint(
        scaleFactor,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
        true,
      );
    },
    [zoomAroundPoint],
  );

  useEffect(() => {
    if (renderVersion === 0) return;

    const containerElement = containerRef.current;
    const svgElement = diagramRef.current?.querySelector("svg");
    if (!(containerElement instanceof HTMLDivElement)) return;
    if (!(svgElement instanceof SVGSVGElement)) return;

    disconnectResizeObserver();
    resetInteractionState();
    userInteractedRef.current = false;
    commitViewState(null);

    svgElement.style.maxWidth = "none";
    const { height, width } = getSvgDimensions(svgElement);
    svgElement.style.width = `${width}px`;
    svgElement.style.height = `${height}px`;

    if (zoomingEnabled || fitToContainer) {
      fitDiagram();
    } else {
      scaleDiagramForReading();
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (zoomingEnabled && userInteractedRef.current) return;
        if (zoomingEnabled || fitToContainer) {
          fitDiagram();
        } else {
          scaleDiagramForReading();
        }
      });
      resizeObserverRef.current = resizeObserver;
      resizeObserver.observe(containerElement);
    }

    setIsPanZoomReady(true);
    if (completedRenderVersionRef.current !== renderVersion) {
      completedRenderVersionRef.current = renderVersion;
      reportRenderComplete();
    }

    return () => {
      resizeObserver?.disconnect();
      if (resizeObserverRef.current === resizeObserver) {
        resizeObserverRef.current = null;
      }
    };
  }, [
    commitViewState,
    disconnectResizeObserver,
    fitDiagram,
    fitToContainer,
    renderVersion,
    resetInteractionState,
    scaleDiagramForReading,
    zoomingEnabled,
  ]);

  useEffect(
    () => () => {
      cancelViewStateFrame();
      cancelPendingZoomLabel();
      disconnectResizeObserver();
    },
    [cancelPendingZoomLabel, cancelViewStateFrame, disconnectResizeObserver],
  );

  const handleWheelEvent = useEffectEvent((event: WheelEvent) => {
    if (!viewStateRef.current) return;
    if (event.deltaX === 0 && event.deltaY === 0) return;

    event.preventDefault();
    if (!isLikelyTrackpadGesture(event)) {
      zoomAroundPoint(
        getWheelZoomScaleFactor(event),
        event.clientX,
        event.clientY,
      );
      return;
    }

    panBy(-event.deltaX, -event.deltaY);
  });

  useEffect(() => {
    if (!zoomingEnabled) return;

    const interactionLayer = interactionLayerRef.current;
    if (!interactionLayer) return;

    const handleWheel = (event: WheelEvent) => {
      handleWheelEvent(event);
    };

    interactionLayer.addEventListener("wheel", handleWheel, {
      passive: false,
    });
    return () => {
      interactionLayer.removeEventListener("wheel", handleWheel);
    };
  }, [zoomingEnabled]);

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (zoomingEnabled) {
        event.preventDefault();
      }
    },
    [zoomingEnabled],
  );

  const handlePointerCancel = useCallback(() => {
    resetInteractionState();
    flushPendingZoomLabel();
  }, [flushPendingZoomLabel, resetInteractionState]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const isTouchPointer = event.pointerType === "touch";
      if (
        !zoomingEnabled ||
        !isPanZoomReady ||
        (!isTouchPointer && event.button !== 0)
      ) {
        return;
      }
      if (!(event.target instanceof Element)) return;

      const isInsideDiagram = Boolean(event.target.closest(".mermaid svg"));
      const isClickableNode = Boolean(event.target.closest(".clickable"));
      const isToolbarControl = Boolean(event.target.closest("button"));
      if (
        (!isTouchPointer && !isInsideDiagram) ||
        isClickableNode ||
        isToolbarControl
      ) {
        return;
      }

      activePointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      event.currentTarget.setPointerCapture(event.pointerId);

      const currentView = viewStateRef.current;
      if (activePointersRef.current.size >= 2 && currentView) {
        const pointerPair = getTrackedPointerPair(activePointersRef.current);
        if (!pointerPair) return;
        const [firstPointer, secondPointer] = pointerPair;
        const midpoint = getPointerMidpoint(firstPointer, secondPointer);
        pinchStateRef.current = {
          startDistance: getDistanceBetweenPointers(
            firstPointer,
            secondPointer,
          ),
          startView: currentView,
          startX: midpoint.x,
          startY: midpoint.y,
        };
        dragStateRef.current = null;
        event.preventDefault();
        return;
      }

      dragStateRef.current = {
        lastX: event.clientX,
        lastY: event.clientY,
        pointerId: event.pointerId,
      };
      event.preventDefault();
    },
    [isPanZoomReady, zoomingEnabled],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointersRef.current.has(event.pointerId)) {
        activePointersRef.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
      }

      if (pinchStateRef.current && activePointersRef.current.size >= 2) {
        const pointerPair = getTrackedPointerPair(activePointersRef.current);
        if (!pointerPair) return;
        const [firstPointer, secondPointer] = pointerPair;
        const midpoint = getPointerMidpoint(firstPointer, secondPointer);
        const distance = getDistanceBetweenPointers(
          firstPointer,
          secondPointer,
        );

        if (distance > 0 && pinchStateRef.current.startDistance > 0) {
          event.preventDefault();
          const nextView = pinchTo(
            pinchStateRef.current.startView,
            pinchStateRef.current.startX,
            pinchStateRef.current.startY,
            midpoint.x,
            midpoint.y,
            getPinchScaleFactor(pinchStateRef.current.startDistance, distance),
          );
          if (nextView) {
            pinchStateRef.current = {
              startDistance: distance,
              startView: nextView,
              startX: midpoint.x,
              startY: midpoint.y,
            };
          }
        }
        return;
      }

      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      panBy(event.clientX - dragState.lastX, event.clientY - dragState.lastY);
      dragStateRef.current = {
        ...dragState,
        lastX: event.clientX,
        lastY: event.clientY,
      };
    },
    [panBy, pinchTo],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      activePointersRef.current.delete(event.pointerId);
      if (activePointersRef.current.size < 2) {
        pinchStateRef.current = null;
        flushPendingZoomLabel();
      }

      if (dragStateRef.current?.pointerId === event.pointerId) {
        dragStateRef.current = null;
      }

      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [flushPendingZoomLabel],
  );

  return {
    containerRef,
    diagramRef,
    disconnectResizeObserver,
    fitDiagram,
    formattedZoom,
    handleDragStart,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    interactionLayerRef,
    isPanZoomReady,
    prepareForRender,
    stepZoom,
  };
}
