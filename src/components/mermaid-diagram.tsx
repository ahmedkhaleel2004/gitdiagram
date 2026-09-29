"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { useTheme } from "next-themes";

import { MermaidDiagramToolbar } from "~/components/mermaid-diagram-toolbar";
import {
  createHiddenRenderTarget,
  withDomNodesSerializingSafely,
  ZOOM_STEP,
} from "~/components/mermaid-diagram-helpers";
import {
  buildMermaidConfig,
  MERMAID_SVG_SANITIZE_OPTIONS,
} from "~/features/diagram/mermaid-config";
import {
  enforceSafeMermaidLinks,
  sanitizeMermaidSourceForRender,
} from "~/features/diagram/mermaid-security";
import { useMermaidViewport } from "~/hooks/use-mermaid-viewport";
import { cn } from "~/lib/utils";

interface MermaidChartProps {
  chart: string;
  zoomingEnabled?: boolean;
  onRenderError?: (message: string) => void;
  onRenderComplete?: () => void;
  containerClassName?: string;
  diagramClassName?: string;
  backgroundColor?: string;
  fitToContainer?: boolean;
}

const INTERACTIVE_FIT_PADDING = 24;
const PREVIEW_FIT_PADDING = 16;
const INTERACTIVE_VIEWER_PROPS = {
  "aria-label": "Interactive diagram viewer",
  role: "region",
  tabIndex: 0,
};

const MermaidChart = ({
  chart,
  zoomingEnabled = true,
  onRenderError,
  onRenderComplete,
  containerClassName,
  diagramClassName,
  backgroundColor,
  fitToContainer = false,
}: MermaidChartProps) => {
  const reportedRenderErrorRef = useRef<string | null>(null);
  const [renderMessage, setRenderMessage] = useState<string | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const fitPadding = zoomingEnabled
    ? INTERACTIVE_FIT_PADDING
    : fitToContainer
      ? PREVIEW_FIT_PADDING
      : 0;
  const {
    containerRef,
    diagramRef,
    disconnectResizeObserver,
    fitDiagram,
    formattedZoom,
    handleClickCapture,
    handleDragStart,
    handleKeyDown,
    handleLostPointerCapture,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    interactionLayerRef,
    isPanZoomReady,
    prepareForRender,
    stepZoom,
  } = useMermaidViewport({
    fitPadding,
    fitToContainer,
    onRenderComplete,
    renderVersion,
    zoomingEnabled,
  });

  const reportRenderError = useEffectEvent((message: string) => {
    onRenderError?.(message);
  });

  useEffect(() => {
    let cancelled = false;

    const baseConfig = buildMermaidConfig({ isDark, backgroundColor });

    const renderDiagram = async () => {
      const mermaidElement = diagramRef.current;
      if (!(mermaidElement instanceof HTMLDivElement)) return;

      setRenderMessage(null);
      prepareForRender();
      mermaid.initialize(baseConfig);
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
        const safeChart = sanitizeMermaidSourceForRender(chart);
        const { svg, bindFunctions } = await withDomNodesSerializingSafely(() =>
          mermaid.render(renderId, safeChart, renderTarget),
        );
        if (cancelled) return;

        mermaidElement.textContent = "";
        mermaidElement.innerHTML = DOMPurify.sanitize(
          svg,
          MERMAID_SVG_SANITIZE_OPTIONS,
        );
        enforceSafeMermaidLinks(mermaidElement);
        bindFunctions?.(mermaidElement);
        setRenderVersion((currentVersion) => currentVersion + 1);
      } catch (error) {
        if (cancelled) return;
        console.error("Mermaid render failed:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Unknown Mermaid render error.";
        setRenderMessage(`Mermaid render failed: ${message}`);
        const reportKey = `${chart}::${message}`;
        if (reportedRenderErrorRef.current !== reportKey) {
          reportedRenderErrorRef.current = reportKey;
          reportRenderError(message);
        }
      } finally {
        renderTarget.remove();
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
      disconnectResizeObserver();
    };
  }, [
    backgroundColor,
    chart,
    containerRef,
    diagramRef,
    disconnectResizeObserver,
    isDark,
    prepareForRender,
  ]);

  return (
    <div
      ref={containerRef}
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
        {...(zoomingEnabled ? INTERACTIVE_VIEWER_PROPS : {})}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative h-full",
          zoomingEnabled
            ? "touch-none"
            : "touch-pan-x touch-pan-y touch-pinch-zoom",
          (zoomingEnabled || fitToContainer) && "overflow-hidden",
          zoomingEnabled &&
            "cursor-grab rounded-xl border border-black/12 bg-white/30 select-none data-[dragging=true]:cursor-grabbing dark:border-white/12 dark:bg-white/[0.03] [&_*]:select-none",
        )}
        onClickCapture={handleClickCapture}
        onDragStart={handleDragStart}
        onLostPointerCapture={handleLostPointerCapture}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {zoomingEnabled && (
          <MermaidDiagramToolbar
            formattedZoom={formattedZoom}
            isPanZoomReady={isPanZoomReady}
            onFit={() => fitDiagram(true, true)}
            onZoomIn={() => stepZoom(ZOOM_STEP)}
            onZoomOut={() => stepZoom(1 / ZOOM_STEP)}
          />
        )}
        <div
          ref={diagramRef}
          className={cn(
            "mermaid text-foreground [&_svg]:mx-auto [&_svg]:block [&_svg]:max-w-full [&_svg]:overflow-visible",
            !isPanZoomReady && "invisible",
            zoomingEnabled && "[&_svg]:h-auto [&_svg]:w-auto",
            !zoomingEnabled && "[&_svg]:h-auto",
            diagramClassName,
          )}
        />
      </div>
    </div>
  );
};

export default MermaidChart;
