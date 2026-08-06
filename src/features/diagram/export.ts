const PNG_EXPORT_SCALE = 4;
const MAX_PNG_EXPORT_DIMENSION = 16_384;
const MAX_PNG_EXPORT_PIXELS = 32_000_000;
/** Longest PDF page side in points (~11"), so the diagram fills a printable page. */
const PDF_MAX_PAGE_SIDE_PT = 792;
const PDF_JPEG_QUALITY = 0.92;

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

function encodeCanvasAsJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Unable to encode diagram JPEG for PDF."));
        }
      },
      "image/jpeg",
      PDF_JPEG_QUALITY,
    );
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

function getExportDimensions(svgElement: SVGSVGElement): {
  width: number;
  height: number;
  scale: number;
} {
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
  return { width, height, scale };
}

async function renderSvgToCanvas(svgElement: SVGSVGElement): Promise<{
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}> {
  const { width, height, scale } = getExportDimensions(svgElement);
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

    return { canvas, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/**
 * Build a one-page PDF whose MediaBox matches the diagram aspect ratio, so the
 * image fills the page with no cropping regardless of width/height.
 */
function buildPdfFromJpeg(
  jpegBytes: Uint8Array,
  imageWidth: number,
  imageHeight: number,
): Blob {
  const scale = Math.min(
    PDF_MAX_PAGE_SIDE_PT / imageWidth,
    PDF_MAX_PAGE_SIDE_PT / imageHeight,
  );
  const pageWidth = imageWidth * scale;
  const pageHeight = imageHeight * scale;

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const objectOffsets: number[] = [0];
  let offset = 0;

  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    offset += bytes.length;
  };

  const pushObject = (content: string | Uint8Array[]) => {
    objectOffsets.push(offset);
    if (typeof content === "string") {
      push(content);
    } else {
      for (const chunk of content) {
        push(chunk);
      }
    }
  };

  push("%PDF-1.4\n");

  pushObject("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  pushObject("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  pushObject(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`,
  );

  const contentStream = `q\n${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
  pushObject(
    `4 0 obj\n<< /Length ${encoder.encode(contentStream).length} >>\nstream\n${contentStream}endstream\nendobj\n`,
  );

  pushObject([
    encoder.encode(
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
    ),
    jpegBytes,
    encoder.encode("\nendstream\nendobj\n"),
  ]);

  const xrefOffset = offset;
  const objectCount = objectOffsets.length;
  push(`xref\n0 ${objectCount}\n`);
  push("0000000000 65535 f \n");
  for (let i = 1; i < objectCount; i++) {
    push(`${String(objectOffsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  // Copy into a fresh ArrayBuffer-backed view so Blob accepts the parts under
  // TypeScript's ArrayBuffer-only BlobPart typing.
  const buffers = parts.map((part) => {
    const copy = new Uint8Array(part.byteLength);
    copy.set(part);
    return copy;
  });
  return new Blob(buffers, { type: "application/pdf" });
}

export async function exportMermaidSvgAsPng(
  svgElement: SVGSVGElement,
): Promise<void> {
  const { canvas } = await renderSvgToCanvas(svgElement);
  // Encoding is asynchronous, avoiding the large synchronous base64 string
  // created by toDataURL for high-resolution diagrams.
  const pngBlob = await encodeCanvasAsPng(canvas);
  downloadBlob(pngBlob, "diagram.png");
}

export async function exportMermaidSvgAsPdf(
  svgElement: SVGSVGElement,
): Promise<void> {
  const { canvas, width, height } = await renderSvgToCanvas(svgElement);
  const jpegBlob = await encodeCanvasAsJpeg(canvas);
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdfBlob = buildPdfFromJpeg(jpegBytes, width, height);
  downloadBlob(pdfBlob, "diagram.pdf");
}
