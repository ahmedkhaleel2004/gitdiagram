import { useCallback } from "react";

import { exportMermaidSvgAsPng } from "~/features/diagram/export";

export function useDiagramExport(diagram: string) {
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(diagram);
  }, [diagram]);

  const handleExportImage = useCallback(() => {
    const svgElement = document.querySelector(".mermaid svg");
    if (!(svgElement instanceof SVGSVGElement)) return;

    void exportMermaidSvgAsPng(svgElement).catch((error: unknown) => {
      console.error("Diagram PNG export failed:", error);
    });
  }, []);

  return {
    handleCopy,
    handleExportImage,
  };
}
