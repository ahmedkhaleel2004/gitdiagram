import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export function exportMermaidSvgAsPng(svgElement: SVGSVGElement): void {
  const canvas = document.createElement("canvas");
  const scale = 4;

  const bbox = svgElement.getBBox();
  const transform = svgElement.getScreenCTM();
  if (!transform) return;

  const width = Math.ceil(bbox.width * transform.a);
  const height = Math.ceil(bbox.height * transform.d);
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const img = new Image();

  img.onload = () => {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    const anchor = document.createElement("a");
    anchor.download = "diagram.png";
    anchor.href = canvas.toDataURL("image/png", 1.0);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  img.src =
    "data:image/svg+xml;base64," +
    btoa(unescape(encodeURIComponent(svgData)));
}

export async function exportDiagramAsPdf(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2, // High DPI for better quality
    useCORS: true, // Allow cross-origin images if any
    backgroundColor: "#ffffff", // Ensure white background
  });

  const imgData = canvas.toDataURL("image/png");

  // Initialize jsPDF with A4 landscape
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  // Margins in mm
  const margin = 10;
  const maxWidth = pdfWidth - margin * 2;
  const maxHeight = pdfHeight - margin * 2;

  // Calculate ratio to fit within max bounds
  const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);

  const finalWidth = canvas.width * ratio;
  const finalHeight = canvas.height * ratio;

  // Center horizontally and vertically
  const x = (pdfWidth - finalWidth) / 2;
  const y = (pdfHeight - finalHeight) / 2;

  pdf.addImage(imgData, "PNG", x, y, finalWidth, finalHeight);
  pdf.save(filename);
}
