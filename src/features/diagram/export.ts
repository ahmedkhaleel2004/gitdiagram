const PNG_EXPORT_SCALE = 4;

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
  const transform = svgElement.getScreenCTM();
  if (!transform) return;

  const width = Math.ceil(bbox.width * transform.a);
  const height = Math.ceil(bbox.height * transform.d);
  if (width <= 0 || height <= 0) return;

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const svgBlob = new Blob([svgData], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadSvgImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width * PNG_EXPORT_SCALE;
    canvas.height = height * PNG_EXPORT_SCALE;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(PNG_EXPORT_SCALE, PNG_EXPORT_SCALE);
    context.drawImage(image, 0, 0, width, height);

    // Encoding is asynchronous, avoiding the large synchronous base64 string
    // created by toDataURL for high-resolution diagrams.
    const pngBlob = await encodeCanvasAsPng(canvas);
    downloadBlob(pngBlob, "diagram.png");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
