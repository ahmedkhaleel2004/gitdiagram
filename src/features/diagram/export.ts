const PNG_EXPORT_SCALE = 4;
const MAX_PNG_EXPORT_DIMENSION = 16_384;
const MAX_PNG_EXPORT_PIXELS = 32_000_000;

function loadSvgImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode diagram SVG."));
    image.src = sourceUrl;
  });
}

function encodeCanvasAsPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Unable to encode diagram PNG."));
      }
    }, "image/png");
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportMermaidSvgAsPng(
  svgElement: SVGSVGElement,
): Promise<void> {
  const bbox = svgElement.getBBox();
  const viewBox = svgElement.viewBox.baseVal;
  const width = viewBox.width > 0 ? viewBox.width : bbox.width;
  const height = viewBox.height > 0 ? viewBox.height : bbox.height;
  if (width <= 0 || height <= 0) {
    throw new Error("Diagram has no exportable dimensions.");
  }
  const scale = Math.min(
    PNG_EXPORT_SCALE,
    MAX_PNG_EXPORT_DIMENSION / width,
    MAX_PNG_EXPORT_DIMENSION / height,
    Math.sqrt(MAX_PNG_EXPORT_PIXELS / (width * height)),
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Diagram is too large to export.");
  }

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const svgBlob = new Blob([svgData], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadSvgImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create an image export canvas.");
    }

    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);

    // Encoding is asynchronous, avoiding the large synchronous base64 string
    // created by toDataURL for high-resolution diagrams.
    const pngBlob = await encodeCanvasAsPng(canvas);
    downloadBlob(pngBlob, "diagram.png");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
