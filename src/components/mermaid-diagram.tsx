"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import { useTheme } from "next-themes";
import { cn } from "~/lib/utils";

interface MermaidChartProps {
  chart: string;
  zoomingEnabled?: boolean;
  onRenderError?: (message: string) => void;
  containerClassName?: string;
  diagramClassName?: string;
  backgroundColor?: string;
}

type SvgPanZoomInstance = {
  destroy: () => void;
};

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

const MermaidChart = ({
  chart,
  zoomingEnabled = true,
  onRenderError,
  containerClassName,
  diagramClassName,
  backgroundColor,
}: MermaidChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const panZoomRef = useRef<SvgPanZoomInstance | null>(null);
  const reportedRenderErrorRef = useRef<string | null>(null);
  const [renderMessage, setRenderMessage] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

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
      panZoomRef.current?.destroy();
      panZoomRef.current = null;

      const applyPanZoom = async () => {
        const svgElement = containerRef.current?.querySelector("svg");
        if (!(svgElement instanceof SVGSVGElement) || !zoomingEnabled) return;

        svgElement.style.maxWidth = "none";
        svgElement.style.width = "100%";
        svgElement.style.height = "100%";

        try {
          const svgPanZoom = (await import("svg-pan-zoom")).default;
          panZoomRef.current = svgPanZoom(svgElement, {
            zoomEnabled: true,
            controlIconsEnabled: true,
            fit: true,
            center: true,
            minZoom: 0.1,
            maxZoom: 10,
            zoomScaleSensitivity: 0.3,
          }) as SvgPanZoomInstance;
        } catch (error) {
          console.error("Failed to load svg-pan-zoom:", error);
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
        await applyPanZoom();
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
      panZoomRef.current?.destroy();
      panZoomRef.current = null;
    };
  }, [backgroundColor, chart, zoomingEnabled, isDark, onRenderError]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full max-w-full p-4",
        zoomingEnabled && "h-[600px]",
        containerClassName,
      )}
    >
      {renderMessage && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {renderMessage}
        </div>
      )}
      <div
        key={`${chart}-${zoomingEnabled}-${resolvedTheme ?? "light"}`}
        className={cn(
          "mermaid h-full text-foreground [&_svg]:block [&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:overflow-visible",
          zoomingEnabled &&
            "rounded-lg border-2 border-black bg-white [&_svg]:h-full [&_svg]:w-full dark:border-[#3b4656] dark:bg-[#1f2631]",
          !zoomingEnabled && "[&_svg]:h-auto",
          diagramClassName,
        )}
      />
    </div>
  );
};

export default MermaidChart;
