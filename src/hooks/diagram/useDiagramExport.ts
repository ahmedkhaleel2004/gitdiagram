import { useCallback } from "react";

import { exportMermaidSvgAsPng } from "~/features/diagram/export";

export function useDiagramExport(diagram: string) {
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(diagram);
  }, [diagram]);

  const handleExportImage = useCallback(() => {
    const svgElement = document.querySelector(".mermaid svg");
    if (!(svgElement instanceof SVGSVGElement)) return;

    exportMermaidSvgAsPng(svgElement);
  }, []);

  return {
    handleCopy,
    handleExportImage,
  };
}
