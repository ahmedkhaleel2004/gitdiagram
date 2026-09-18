"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import {
  clampViewState,
  getDefaultDiagramScale,
  getSvgDimensions,
  type ViewState,
} from "~/components/mermaid-diagram-helpers";

import { useDiagramPointerGestures } from "~/hooks/use-diagram-pointer-gestures";
import { useDiagramWheelGestures } from "~/hooks/use-diagram-wheel-gestures";

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

function getViewportBounds(element: HTMLDivElement) {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left + element.clientLeft,
    top: rect.top + element.clientTop,
    width: element.clientWidth || rect.width,
    height: element.clientHeight || rect.height,
  };
}

function getFitScale(
  bounds: { width: number; height: number },
  content: { width: number; height: number },
  padding: number,
) {
  return Math.min(
    Math.max(bounds.width - padding * 2, 1) / content.width,
    Math.max(bounds.height - padding * 2, 1) / content.height,
  );
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
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const viewStateRef = useRef<ViewState | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const animationTargetRef = useRef<ViewState | null>(null);
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

  const cancelViewAnimation = useCallback(() => {
    if (animationFrameRef.current !== null)
      cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    animationTargetRef.current = null;
  }, []);

  const commitViewState = useCallback(
    (nextView: ViewState | null) => {
      cancelViewAnimation();
      cancelViewStateFrame();
      cancelPendingZoomLabel();
      viewStateRef.current = nextView;
      applyViewState(diagramRef.current, nextView);
      updateZoomLabel(nextView);
    },
    [
      cancelPendingZoomLabel,
      cancelViewAnimation,
      cancelViewStateFrame,
      updateZoomLabel,
    ],
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

  const animateViewState = useCallback(
    (target: ViewState) => {
      const from = viewStateRef.current;
      if (
        !from ||
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        commitViewState(target);
        return;
      }
      cancelViewAnimation();
      cancelViewStateFrame();
      animationTargetRef.current = target;
      let start: number | null = null;
      const tick = (now: number) => {
        start ??= now;
        const progress = Math.max(0, Math.min((now - start) / 160, 1));
        const eased = 1 - (1 - progress) ** 3;
        const next = {
          ...target,
          x: from.x + (target.x - from.x) * eased,
          y: from.y + (target.y - from.y) * eased,
          scale: from.scale + (target.scale - from.scale) * eased,
        };
        viewStateRef.current = next;
        applyViewState(diagramRef.current, next);
        scheduleZoomLabel(next);
        if (progress < 1)
          animationFrameRef.current = requestAnimationFrame(tick);
        else commitViewState(target);
      };
      animationFrameRef.current = requestAnimationFrame(tick);
    },
    [
      cancelViewAnimation,
      cancelViewStateFrame,
      commitViewState,
      scheduleZoomLabel,
    ],
  );

  const disconnectResizeObserver = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  const fitDiagram = useCallback(
    (animate = false) => {
      const containerElement = interactionLayerRef.current;
      const svgElement = diagramRef.current?.querySelector("svg");
      if (!(containerElement instanceof HTMLDivElement)) return;
      if (!(svgElement instanceof SVGSVGElement)) return;

      const bounds = getViewportBounds(containerElement);
      const { height, width } = getSvgDimensions(svgElement);
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const scale = getFitScale(bounds, { width, height }, fitPadding);

      userInteractedRef.current = false;
      (animate ? animateViewState : commitViewState)({
        fitScale: scale,
        height,
        scale,
        width,
        x: (bounds.width - width * scale) / 2,
        y: (bounds.height - height * scale) / 2,
      });
    },
    [animateViewState, commitViewState, fitPadding],
  );

  const scaleDiagramForReading = useCallback(() => {
    const containerElement = interactionLayerRef.current;
    const svgElement = diagramRef.current?.querySelector("svg");
    if (!(containerElement instanceof HTMLDivElement)) return;
    if (!(svgElement instanceof SVGSVGElement)) return;

    const { height, width } = getSvgDimensions(svgElement);
    const scale = getDefaultDiagramScale({
      containerWidth: getViewportBounds(containerElement).width,
      contentWidth: width,
    });

    svgElement.style.width = `${width * scale}px`;
    svgElement.style.height = `${height * scale}px`;
  }, []);

  const zoomAroundPoint = useCallback(
    (
      scaleFactor: number,
      clientX: number,
      clientY: number,
      animate = false,
    ) => {
      const currentView =
        (animate ? animationTargetRef.current : null) ?? viewStateRef.current;
      const containerElement = interactionLayerRef.current;
      if (!currentView || !(containerElement instanceof HTMLDivElement)) return;

      const bounds = getViewportBounds(containerElement);
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
      if (animate) {
        animateViewState(nextView);
      } else {
        scheduleViewState(nextView, true);
      }
    },
    [animateViewState, scheduleViewState],
  );

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const currentView = viewStateRef.current;
      const containerElement = interactionLayerRef.current;
      if (!currentView || !(containerElement instanceof HTMLDivElement)) return;

      const bounds = getViewportBounds(containerElement);
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
      const containerElement = interactionLayerRef.current;
      if (!(containerElement instanceof HTMLDivElement)) return null;

      const bounds = getViewportBounds(containerElement);
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
      const containerElement = interactionLayerRef.current;
      if (!(containerElement instanceof HTMLDivElement)) return;

      const bounds = getViewportBounds(containerElement);
      zoomAroundPoint(
        scaleFactor,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
        true,
      );
    },
    [zoomAroundPoint],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        !zoomingEnabled ||
        !isPanZoomReady ||
        event.target !== event.currentTarget ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      switch (event.key) {
        case "+":
        case "=":
          stepZoom(1.18);
          break;
        case "-":
          stepZoom(1 / 1.18);
          break;
        case "0":
        case "Home":
          fitDiagram(true);
          break;
        case "ArrowLeft":
          cancelViewAnimation();
          panBy(40, 0);
          break;
        case "ArrowRight":
          cancelViewAnimation();
          panBy(-40, 0);
          break;
        case "ArrowUp":
          cancelViewAnimation();
          panBy(0, 40);
          break;
        case "ArrowDown":
          cancelViewAnimation();
          panBy(0, -40);
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [
      cancelViewAnimation,
      fitDiagram,
      isPanZoomReady,
      panBy,
      stepZoom,
      zoomingEnabled,
    ],
  );

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (zoomingEnabled) {
        event.preventDefault();
      }
    },
    [zoomingEnabled],
  );

  const {
    handleClickCapture,
    handleLostPointerCapture,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    resetInteractionState,
    hasActivePointers,
  } = useDiagramPointerGestures({
    enabled: zoomingEnabled && isPanZoomReady,
    layerRef: interactionLayerRef,
    viewRef: viewStateRef,
    onStart: cancelViewAnimation,
    onEnd: flushPendingZoomLabel,
    panBy,
    pinchTo,
  });

  useDiagramWheelGestures({
    enabled: zoomingEnabled && isPanZoomReady,
    layerRef: interactionLayerRef,
    onStart: cancelViewAnimation,
    hasActivePointers,
    panBy,
    zoomAroundPoint,
  });

  const resetViewportInteraction = useEffectEvent(() => {
    resetInteractionState();
    cancelViewAnimation();
    flushPendingZoomLabel();
  });

  useEffect(() => {
    const reset = () => resetViewportInteraction();
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("blur", reset);
      reset();
    };
  }, []);

  const prepareForRender = useCallback(() => {
    setIsPanZoomReady(false);
    disconnectResizeObserver();
    resetInteractionState();
    userInteractedRef.current = false;
    commitViewState(null);
  }, [commitViewState, disconnectResizeObserver, resetInteractionState]);

  useEffect(() => {
    if (renderVersion === 0) return;

    const containerElement = interactionLayerRef.current;
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

    let previousBounds = getViewportBounds(containerElement);
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        const bounds = getViewportBounds(containerElement);
        if (bounds.width <= 0 || bounds.height <= 0) return;
        if (
          bounds.width === previousBounds.width &&
          bounds.height === previousBounds.height
        )
          return;
        const previous = previousBounds;
        previousBounds = bounds;
        const current = viewStateRef.current;
        if (zoomingEnabled && userInteractedRef.current && current) {
          resetInteractionState();
          const fitScale = getFitScale(bounds, current, fitPadding);
          const scale = Math.min(
            fitScale * 12,
            Math.max(fitScale * 0.6, current.scale),
          );
          const centerX = (previous.width / 2 - current.x) / current.scale;
          const centerY = (previous.height / 2 - current.y) / current.scale;
          const position = clampViewState({
            containerWidth: bounds.width,
            containerHeight: bounds.height,
            contentWidth: current.width,
            contentHeight: current.height,
            nextScale: scale,
            nextX: bounds.width / 2 - centerX * scale,
            nextY: bounds.height / 2 - centerY * scale,
          });
          commitViewState({ ...current, ...position, fitScale, scale });
          return;
        }
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
    fitPadding,
    fitToContainer,
    renderVersion,
    resetInteractionState,
    scaleDiagramForReading,
    zoomingEnabled,
  ]);

  useEffect(
    () => () => {
      cancelViewAnimation();
      cancelViewStateFrame();
      cancelPendingZoomLabel();
      disconnectResizeObserver();
    },
    [
      cancelPendingZoomLabel,
      cancelViewAnimation,
      cancelViewStateFrame,
      disconnectResizeObserver,
    ],
  );

  return {
    containerRef,
    diagramRef,
    disconnectResizeObserver,
    fitDiagram,
    formattedZoom,
    handleDragStart,
    handleKeyDown,
    handleClickCapture,
    handlePointerCancel: handlePointerUp,
    handleLostPointerCapture,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    interactionLayerRef,
    isPanZoomReady,
    prepareForRender,
    stepZoom,
  };
}
