import { useCallback, useState } from "react";
import { toast } from "sonner";

import { exportMermaidSvgAsPng, exportDiagramAsPdf } from "~/features/diagram/export";

export function useDiagramExport(diagram: string, repo: string = "diagram") {
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(diagram);
  }, [diagram]);

  const handleExportImage = useCallback(() => {
    const svgElement = document.querySelector(".mermaid svg");
    if (!(svgElement instanceof SVGSVGElement)) return;

    exportMermaidSvgAsPng(svgElement);
  }, []);

  const handleExportPdf = useCallback(async () => {
    const container = document.querySelector(".mermaid");
    if (!(container instanceof HTMLElement)) {
      toast.error("Diagram container not found");
      return;
    }

    try {
      setIsExportingPdf(true);
      await exportDiagramAsPdf(container, `${repo}.pdf`);
      toast.success("PDF exported successfully");
    } catch (error) {
      console.error("Failed to export PDF:", error);
      toast.error("Failed to export PDF");
    } finally {
      setIsExportingPdf(false);
    }
  }, [repo]);

  return {
    handleCopy,
    handleExportImage,
    handleExportPdf,
    isExportingPdf,
  };
}
