"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import { useTheme } from "next-themes";
import { Minus, Plus, ScanSearch } from "lucide-react";
import { cn } from "~/lib/utils";

interface MermaidChartProps {
  chart: string;
  zoomingEnabled?: boolean;
  onRenderError?: (message: string) => void;
  containerClassName?: string;
  diagramClassName?: string;
  backgroundColor?: string;
  fitToContainer?: boolean;
}

type ViewState = {
  fitScale: number;
  height: number;
  scale: number;
  width: number;
  x: number;
  y: number;
};

const INTERACTIVE_FIT_PADDING = 24;
const PREVIEW_FIT_PADDING = 16;

let elkLayoutRegistered = false;
let domToJsonPatched = false;

function ensureDomNodesSerializeSafely() {
  if (domToJsonPatched || typeof window === "undefined") return;

  const elementProto = window.Element?.prototype;
  if (!elementProto || "toJSON" in elementProto) {
    domToJsonPatched = true;
    return;
  }

  Object.defineProperty(elementProto, "toJSON", {
    configurable: true,
    value: function toJSON(this: Element) {
      return {
        tagName: this.tagName,
        id: this.id || undefined,
        className:
          typeof this.className === "string" ? this.className : undefined,
      };
    },
  });

  domToJsonPatched = true;
}

function createHiddenRenderTarget(width: number) {
  const renderTarget = document.createElement("div");
  renderTarget.setAttribute("aria-hidden", "true");
  renderTarget.style.position = "absolute";
  renderTarget.style.visibility = "hidden";
  renderTarget.style.pointerEvents = "none";
  renderTarget.style.overflow = "hidden";
  renderTarget.style.left = "0";
  renderTarget.style.top = "0";
  renderTarget.style.zIndex = "-1";
  renderTarget.style.width = `${Math.max(width, 1)}px`;
  document.body.append(renderTarget);
  return renderTarget;
}

function clampViewState({
  nextScale,
  nextX,
  nextY,
  containerHeight,
  containerWidth,
  contentHeight,
  contentWidth,
}: {
  containerHeight: number;
  containerWidth: number;
  contentHeight: number;
  contentWidth: number;
  nextScale: number;
  nextX: number;
  nextY: number;
}) {
  const scaledWidth = contentWidth * nextScale;
  const scaledHeight = contentHeight * nextScale;
  const horizontalGutter = Math.max(32, Math.min(160, containerWidth * 0.12));
  const verticalGutter = Math.max(32, Math.min(160, containerHeight * 0.12));

  const x =
    scaledWidth <= containerWidth
      ? (containerWidth - scaledWidth) / 2
      : Math.max(
          containerWidth - scaledWidth - horizontalGutter,
          Math.min(horizontalGutter, nextX),
        );

  const y =
    scaledHeight <= containerHeight
      ? (containerHeight - scaledHeight) / 2
      : Math.max(
          containerHeight - scaledHeight - verticalGutter,
          Math.min(verticalGutter, nextY),
        );

  return { x, y };
}

function getSvgDimensions(svgElement: SVGSVGElement) {
  const viewBox = svgElement.viewBox.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return {
      height: viewBox.height,
      width: viewBox.width,
    };
  }

  const bbox = svgElement.getBBox();
  return {
    height: Math.max(bbox.height, 1),
    width: Math.max(bbox.width, 1),
  };
}

export function normalizeWheelDelta(
  event: Pick<WheelEvent, "deltaMode" | "deltaY">,
) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * 120;
  }

  return event.deltaY;
}

export function isLikelyTrackpadGesture(
  event: Pick<WheelEvent, "ctrlKey" | "metaKey" | "deltaMode" | "deltaX" | "deltaY">,
) {
  if (event.ctrlKey || event.metaKey) return false;
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false;

  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  return absX > 0 || absY < 40;
}

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
  const dragStateRef = useRef<{
    lastX: number;
    lastY: number;
    pointerId: number;
  } | null>(null);
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
      mermaid.registerLayoutLoaders(elkLayouts);
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
      userInteractedRef.current = false;
      dragStateRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      const applyInteractiveView = () => {
        const svgElement = containerRef.current?.querySelector(".mermaid svg");
        if (!(svgElement instanceof SVGSVGElement)) return;

        svgElement.style.maxWidth = "none";

        if (!zoomingEnabled) {
          if (fitToContainer) {
            const { height, width } = getSvgDimensions(svgElement);
            svgElement.style.width = `${width}px`;
            svgElement.style.height = `${height}px`;
            fitDiagram();
          } else {
            svgElement.style.width = "100%";
            svgElement.style.height = "auto";
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
          error instanceof Error ? error.message : "Unknown Mermaid render error.";
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
          Math.exp(-normalizeWheelDelta(event) * 0.0015),
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
        zoomingEnabled && "h-[70vh] min-h-[22rem] max-h-[52rem]",
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
          "relative h-full touch-none",
          (zoomingEnabled || fitToContainer) && "overflow-hidden",
          zoomingEnabled &&
            "rounded-xl border border-black/12 bg-white/30 dark:border-white/12 dark:bg-white/[0.03]",
        )}
        onPointerCancel={() => {
          dragStateRef.current = null;
        }}
        onPointerDown={(event) => {
          if (!zoomingEnabled || !isPanZoomReady || event.button !== 0) return;
          if (!(event.target instanceof Element)) return;

          const isInsideDiagram = Boolean(event.target.closest(".mermaid svg"));
          const isClickableNode = Boolean(event.target.closest(".clickable"));
          if (!isInsideDiagram || isClickableNode) return;

          dragStateRef.current = {
            lastX: event.clientX,
            lastY: event.clientY,
            pointerId: event.pointerId,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const dragState = dragStateRef.current;
          if (!dragState || dragState.pointerId !== event.pointerId) return;

          panBy(event.clientX - dragState.lastX, event.clientY - dragState.lastY);
          dragStateRef.current = {
            ...dragState,
            lastX: event.clientX,
            lastY: event.clientY,
          };
        }}
        onPointerUp={(event) => {
          if (dragStateRef.current?.pointerId !== event.pointerId) return;
          dragStateRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        {zoomingEnabled && (
          <>
            <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-2">
              <div className="pointer-events-auto flex items-center overflow-hidden rounded-full border border-black/10 bg-white/80 shadow-[0_10px_30px_rgba(15,23,42,0.14)] ring-1 ring-white/70 backdrop-blur-md dark:border-white/10 dark:bg-[#101722]/78 dark:ring-white/10 dark:shadow-[0_12px_32px_rgba(0,0,0,0.32)]">
                <button
                  type="button"
                  aria-label="Zoom out"
                  disabled={!isPanZoomReady}
                  className="flex h-10 w-10 items-center justify-center text-black transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-100 dark:hover:bg-white/5"
                  onClick={() => stepZoom(0.85)}
                >
                  <Minus size={18} />
                </button>
                <div className="min-w-16 border-x border-black/10 px-3 text-center text-[11px] font-semibold tracking-[0.16em] text-black/80 uppercase dark:border-white/10 dark:text-neutral-100/80">
                  {formattedZoom}
                </div>
                <button
                  type="button"
                  aria-label="Zoom in"
                  disabled={!isPanZoomReady}
                  className="flex h-10 w-10 items-center justify-center text-black transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-100 dark:hover:bg-white/5"
                  onClick={() => stepZoom(1.18)}
                >
                  <Plus size={18} />
                </button>
              </div>
              <button
                type="button"
                disabled={!isPanZoomReady}
                className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full border border-black/10 bg-white/80 px-3 text-[11px] font-semibold tracking-[0.16em] text-black/80 uppercase shadow-[0_10px_30px_rgba(15,23,42,0.14)] ring-1 ring-white/70 backdrop-blur-md transition-colors hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-[#101722]/78 dark:text-neutral-100/80 dark:ring-white/10 dark:shadow-[0_12px_32px_rgba(0,0,0,0.32)] dark:hover:bg-[#18202c]/92"
                onClick={fitDiagram}
              >
                <ScanSearch size={16} />
                Fit
              </button>
            </div>
          </>
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
            "mermaid text-foreground [&_svg]:block [&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:overflow-visible",
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
