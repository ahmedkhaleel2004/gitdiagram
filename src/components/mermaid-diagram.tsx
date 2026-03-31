"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import { useTheme } from "next-themes";

import { MermaidDiagramToolbar } from "~/components/mermaid-diagram-toolbar";
import {
  clampViewState,
  createHiddenRenderTarget,
  ensureDomNodesSerializeSafely,
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
import { cn } from "~/lib/utils";

export {
  getDefaultDiagramScale,
  getPinchScaleFactor,
  getWheelZoomScaleFactor,
  isLikelyTrackpadGesture,
  normalizeWheelDelta,
} from "~/components/mermaid-diagram-helpers";

interface MermaidChartProps {
  chart: string;
  zoomingEnabled?: boolean;
  onRenderError?: (message: string) => void;
  containerClassName?: string;
  diagramClassName?: string;
  backgroundColor?: string;
  fitToContainer?: boolean;
}

const INTERACTIVE_FIT_PADDING = 24;
const PREVIEW_FIT_PADDING = 16;

let elkLayoutRegistered = false;
type MermaidLayoutLoaders = Parameters<typeof mermaid.registerLayoutLoaders>[0];

const MermaidChart = ({
  chart,
  zoomingEnabled = true,
  onRenderError,
  containerClassName,
  diagramClassName,
  backgroundColor,
  fitToContainer = false,
}: MermaidChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const interactionLayerRef = useRef<HTMLDivElement>(null);
  const activePointersRef = useRef<Map<number, PointerCoordinates>>(new Map());
  const dragStateRef = useRef<{
    lastX: number;
    lastY: number;
    pointerId: number;
  } | null>(null);
  const pinchStateRef = useRef<PinchState | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const userInteractedRef = useRef(false);
  const reportedRenderErrorRef = useRef<string | null>(null);
  const [isPanZoomReady, setIsPanZoomReady] = useState(false);
  const [viewState, setViewState] = useState<ViewState | null>(null);
  const [renderMessage, setRenderMessage] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const fitPadding = zoomingEnabled
    ? INTERACTIVE_FIT_PADDING
    : fitToContainer
      ? PREVIEW_FIT_PADDING
      : 0;

  const fitDiagram = useCallback(() => {
    const containerElement = containerRef.current;
    const svgElement = containerElement?.querySelector(".mermaid svg");
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
    setViewState({
      fitScale: scale,
      height,
      scale,
      width,
      x: insetX + (availableWidth - width * scale) / 2,
      y: insetY + (availableHeight - height * scale) / 2,
    });
  }, [fitPadding]);

  const scaleDiagramForReading = useCallback(() => {
    const containerElement = containerRef.current;
    const svgElement = containerElement?.querySelector(".mermaid svg");
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
    (scaleFactor: number, clientX: number, clientY: number) => {
      const currentView = viewState;
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

      userInteractedRef.current = true;
      setViewState({
        ...currentView,
        scale: nextScale,
        x: clamped.x,
        y: clamped.y,
      });
    },
    [viewState],
  );

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const currentView = viewState;
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
      setViewState({
        ...currentView,
        x: clamped.x,
        y: clamped.y,
      });
    },
    [viewState],
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
      setViewState(nextView);
      return nextView;
    },
    [],
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
      );
    },
    [zoomAroundPoint],
  );

  useEffect(() => {
    ensureDomNodesSerializeSafely();

    if (!elkLayoutRegistered) {
      mermaid.registerLayoutLoaders(elkLayouts as MermaidLayoutLoaders);
      elkLayoutRegistered = true;
    }

    const baseConfig = {
      startOnLoad: false,
      suppressErrorRendering: true,
      securityLevel: "loose" as const,
      theme: "base" as const,
      htmlLabels: true,
      flowchart: {
        defaultRenderer: "elk" as const,
        curve: "linear" as const,
        nodeSpacing: 50,
        rankSpacing: 50,
        padding: 15,
      },
      themeVariables: isDark
        ? {
            background: backgroundColor ?? "#1f2631",
            primaryColor: "#2c3544",
            primaryBorderColor: "#6dd4e9",
            primaryTextColor: "#e8edf5",
            lineColor: "#ffd486",
            secondaryColor: "#26303f",
            tertiaryColor: "#323d4d",
          }
        : {
            background: backgroundColor ?? "#ffffff",
            primaryColor: "#f7f7f7",
            primaryBorderColor: "#000000",
            primaryTextColor: "#171717",
            lineColor: "#000000",
            secondaryColor: "#f0f0f0",
            tertiaryColor: "#f7f7f7",
          },
      themeCSS: `
        .clickable {
          transition: transform 0.2s ease;
        }
        .clickable:hover {
          transform: scale(1.05);
          cursor: pointer;
        }
        .clickable:hover > * {
          filter: brightness(0.85);
        }
      `,
    };

    const initializeMermaid = () => {
      mermaid.initialize({
        ...baseConfig,
      });
    };

    const renderDiagram = async () => {
      const mermaidElement = containerRef.current?.querySelector(".mermaid");
      if (!(mermaidElement instanceof HTMLDivElement)) return;

      setRenderMessage(null);
      setIsPanZoomReady(false);
      setViewState(null);
      activePointersRef.current.clear();
      pinchStateRef.current = null;
      userInteractedRef.current = false;
      dragStateRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      const applyInteractiveView = () => {
        const svgElement = containerRef.current?.querySelector(".mermaid svg");
        if (!(svgElement instanceof SVGSVGElement)) return;

        svgElement.style.maxWidth = "none";

        if (!zoomingEnabled) {
          const { height, width } = getSvgDimensions(svgElement);
          svgElement.style.width = `${width}px`;
          svgElement.style.height = `${height}px`;

          if (fitToContainer) {
            fitDiagram();
          } else {
            scaleDiagramForReading();
          }

          if (typeof ResizeObserver !== "undefined" && containerRef.current) {
            resizeObserverRef.current = new ResizeObserver(() => {
              if (fitToContainer) {
                fitDiagram();
                return;
              }

              scaleDiagramForReading();
            });

            resizeObserverRef.current.observe(containerRef.current);
          }

          setIsPanZoomReady(true);
          return;
        }

        const { height, width } = getSvgDimensions(svgElement);
        svgElement.style.width = `${width}px`;
        svgElement.style.height = `${height}px`;
        fitDiagram();
        setIsPanZoomReady(true);

        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          resizeObserverRef.current = new ResizeObserver(() => {
            if (!userInteractedRef.current) {
              fitDiagram();
            }
          });

          resizeObserverRef.current.observe(containerRef.current);
        }
      };

      initializeMermaid();
      mermaidElement.removeAttribute("data-processed");
      const renderTarget = createHiddenRenderTarget(
        Math.round(
          mermaidElement.getBoundingClientRect().width ||
            containerRef.current?.getBoundingClientRect().width ||
            window.innerWidth,
        ),
      );

      try {
        const renderId = `gitdiagram-${Math.random().toString(36).slice(2)}`;
        const { svg, bindFunctions } = await mermaid.render(
          renderId,
          chart,
          renderTarget,
        );
        mermaidElement.textContent = "";
        mermaidElement.innerHTML = svg;
        bindFunctions?.(mermaidElement);
        applyInteractiveView();
        return;
      } catch (error) {
        console.error("Mermaid render failed:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Unknown Mermaid render error.";
        setRenderMessage(`Mermaid render failed: ${message}`);
        const reportKey = `${chart}::${message}`;
        if (reportedRenderErrorRef.current !== reportKey) {
          reportedRenderErrorRef.current = reportKey;
          onRenderError?.(message);
        }
      } finally {
        renderTarget.remove();
      }
    };

    void renderDiagram();

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, [
    backgroundColor,
    chart,
    fitToContainer,
    fitDiagram,
    scaleDiagramForReading,
    zoomingEnabled,
    isDark,
    onRenderError,
  ]);

  useEffect(() => {
    if (!zoomingEnabled) return;

    const interactionLayer = interactionLayerRef.current;
    if (!interactionLayer) return;

    const handleWheel = (event: WheelEvent) => {
      if (!viewState) return;
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
    };

    interactionLayer.addEventListener("wheel", handleWheel, {
      passive: false,
    });

    return () => {
      interactionLayer.removeEventListener("wheel", handleWheel);
    };
  }, [panBy, viewState, zoomAroundPoint, zoomingEnabled]);

  const formattedZoom = `${Math.round(
    ((viewState?.scale ?? 1) / (viewState?.fitScale ?? 1)) * 100,
  )}%`;

  return (
    <div
      ref={containerRef}
      aria-label={zoomingEnabled ? "Interactive diagram viewer" : undefined}
      role={zoomingEnabled ? "region" : undefined}
      className={cn(
        "w-full p-4",
        zoomingEnabled && "h-[70vh] max-h-[52rem] min-h-[22rem]",
        containerClassName,
      )}
    >
      {renderMessage && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {renderMessage}
        </div>
      )}
      <div
        ref={interactionLayerRef}
        className={cn(
          "relative h-full",
          zoomingEnabled ? "touch-none" : "touch-pan-y",
          (zoomingEnabled || fitToContainer) && "overflow-hidden",
          zoomingEnabled &&
            "rounded-xl border border-black/12 bg-white/30 select-none dark:border-white/12 dark:bg-white/[0.03] [&_*]:select-none",
        )}
        onDragStart={(event) => {
          if (zoomingEnabled) {
            event.preventDefault();
          }
        }}
        onPointerCancel={() => {
          activePointersRef.current.clear();
          dragStateRef.current = null;
          pinchStateRef.current = null;
        }}
        onPointerDown={(event) => {
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

          if (activePointersRef.current.size >= 2 && viewState) {
            const pointerPair = getTrackedPointerPair(
              activePointersRef.current,
            );
            if (!pointerPair) return;
            const [firstPointer, secondPointer] = pointerPair;
            const midpoint = getPointerMidpoint(firstPointer, secondPointer);
            pinchStateRef.current = {
              startDistance: getDistanceBetweenPointers(
                firstPointer,
                secondPointer,
              ),
              startView: viewState,
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
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (activePointersRef.current.has(event.pointerId)) {
            activePointersRef.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });
          }

          if (pinchStateRef.current && activePointersRef.current.size >= 2) {
            const pointerPair = getTrackedPointerPair(
              activePointersRef.current,
            );
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
                getPinchScaleFactor(
                  pinchStateRef.current.startDistance,
                  distance,
                ),
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
          panBy(
            event.clientX - dragState.lastX,
            event.clientY - dragState.lastY,
          );
          dragStateRef.current = {
            ...dragState,
            lastX: event.clientX,
            lastY: event.clientY,
          };
        }}
        onPointerUp={(event) => {
          activePointersRef.current.delete(event.pointerId);
          if (activePointersRef.current.size < 2) {
            pinchStateRef.current = null;
          }

          if (dragStateRef.current?.pointerId === event.pointerId) {
            dragStateRef.current = null;
          }

          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        {zoomingEnabled && (
          <MermaidDiagramToolbar
            formattedZoom={formattedZoom}
            isPanZoomReady={isPanZoomReady}
            onFit={fitDiagram}
            onZoomIn={() => stepZoom(1.18)}
            onZoomOut={() => stepZoom(0.85)}
          />
        )}
        <div
          key={`${chart}-${zoomingEnabled}-${resolvedTheme ?? "light"}`}
          style={
            viewState && (zoomingEnabled || fitToContainer)
              ? {
                  left: 0,
                  position: "absolute",
                  top: 0,
                  transform: `translate3d(${viewState.x}px, ${viewState.y}px, 0) scale(${viewState.scale})`,
                  transformOrigin: "0 0",
                }
              : undefined
          }
          className={cn(
            "mermaid text-foreground [&_svg]:mx-auto [&_svg]:block [&_svg]:max-w-full [&_svg]:overflow-visible",
            !isPanZoomReady && "invisible",
            zoomingEnabled &&
              "cursor-grab active:cursor-grabbing [&_svg]:h-auto [&_svg]:w-auto",
            !zoomingEnabled && "[&_svg]:h-auto",
            diagramClassName,
          )}
        />
      </div>
    </div>
  );
};

export default MermaidChart;
