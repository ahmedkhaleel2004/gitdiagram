"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import { useTheme } from "next-themes";

import { MermaidDiagramToolbar } from "~/components/mermaid-diagram-toolbar";
import {
  createHiddenRenderTarget,
  withDomNodesSerializingSafely,
} from "~/components/mermaid-diagram-helpers";
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

let elkLayoutRegistered = false;
type MermaidLayoutLoaders = Parameters<typeof mermaid.registerLayoutLoaders>[0];

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
    handleDragStart,
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

    if (!elkLayoutRegistered) {
      mermaid.registerLayoutLoaders(elkLayouts as MermaidLayoutLoaders);
      elkLayoutRegistered = true;
    }

    const baseConfig = {
      startOnLoad: false,
      suppressErrorRendering: true,
      securityLevel: "antiscript" as const,
      secure: ["securityLevel", "startOnLoad", "maxTextSize"],
      theme: "base" as const,
      // Pure SVG labels survive strict sanitization without relying on
      // foreignObject HTML, which is both harder to secure and less portable.
      htmlLabels: false,
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
        .clickable > * {
          scale: 1;
          transform-box: fill-box;
          transform-origin: center;
          transition: scale 160ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .clickable {
          cursor: pointer;
        }
        @media (hover: hover) and (pointer: fine) {
          .clickable:hover > * {
            scale: 1.05;
            filter: brightness(0.85);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .clickable > * {
            transition: none;
          }
          .clickable:hover > * {
            scale: 1;
          }
        }
      `,
    };

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
        mermaidElement.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
          FORBID_TAGS: ["script"],
        });
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
          zoomingEnabled
            ? "touch-none"
            : "touch-pan-x touch-pan-y touch-pinch-zoom",
          (zoomingEnabled || fitToContainer) && "overflow-hidden",
          zoomingEnabled &&
            "rounded-xl border border-black/12 bg-white/30 select-none dark:border-white/12 dark:bg-white/[0.03] [&_*]:select-none",
        )}
        onDragStart={handleDragStart}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
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
          ref={diagramRef}
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
