const PNG_EXPORT_SCALE = 4;
const MAX_PNG_EXPORT_DIMENSION = 16_000;
// A 120M-pixel canvas is ~480 MB of RGBA; a bigger one is halved until it fits.
const MAX_PNG_EXPORT_PIXELS = 120_000_000;
// iPhone and iPad Safari refuse (or silently blank) canvases over 16.7M pixels.
const MAX_MOBILE_WEBKIT_PIXELS = 16_000_000;
const SVG_NS = "http://www.w3.org/2000/svg";

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

function isMobileWebKit() {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/**
 * Pixels per diagram unit: 4x for ordinary diagrams, never over ~16k pixels a
 * side or the device's canvas budget. The page's zoom never enters into it.
 */
export function getPngExportScale(
  width: number,
  height: number,
  maxPixels = isMobileWebKit()
    ? MAX_MOBILE_WEBKIT_PIXELS
    : MAX_PNG_EXPORT_PIXELS,
) {
  return Math.min(
    PNG_EXPORT_SCALE,
    MAX_PNG_EXPORT_DIMENSION / width,
    MAX_PNG_EXPORT_DIMENSION / height,
    Math.sqrt(maxPixels / (width * height)),
  );
}

/** The link strip under the diagram, in diagram units. */
export function getExportFooter(width: number, height: number) {
  const fontSize = Math.min(24, Math.max(12, Math.max(width, height) * 0.007));
  return { fontSize, height: Math.round(fontSize * 2.2) };
}

// Muted text that reads on the diagram's own background, light or dark.
function footerTextColor(backgroundColor: string) {
  const channels = backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3) return "rgba(0, 0, 0, 0.5)";
  const [red, green, blue] = channels as [number, number, number];
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance < 128 ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.5)";
}

/**
 * A copy of the diagram sized to the pixels it is drawn at, so every browser
 * rasterizes it sharp; the page's own sizing (and any zoom) is left behind.
 */
function standaloneSvg(
  svgElement: SVGSVGElement,
  width: number,
  height: number,
  scale: number,
) {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  for (const property of ["width", "height", "max-width", "transform"]) {
    clone.style.removeProperty(property);
  }
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(Math.ceil(width * scale)));
  clone.setAttribute("height", String(Math.ceil(height * scale)));
  return new XMLSerializer().serializeToString(clone);
}

async function renderPng(
  svgElement: SVGSVGElement,
  width: number,
  height: number,
  scale: number,
  backgroundColor: string,
  footerText: string | undefined,
) {
  const footer = footerText ? getExportFooter(width, height) : null;
  const svgBlob = new Blob([standaloneSvg(svgElement, width, height, scale)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadSvgImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(
      1,
      Math.floor((height + (footer?.height ?? 0)) * scale),
    );

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create an image export canvas.");
    }

    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    if (footer && footerText) {
      context.fillStyle = footerTextColor(backgroundColor);
      context.font = `500 ${footer.fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(
        footerText,
        width - footer.fontSize * 1.2,
        height + footer.height / 2,
      );
    }

    // Encoding is asynchronous, avoiding the large synchronous base64 string
    // created by toDataURL for high-resolution diagrams.
    return await encodeCanvasAsPng(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export async function exportMermaidSvgAsPng(
  svgElement: SVGSVGElement,
  backgroundColor = "white",
  repository?: string,
): Promise<void> {
  const bbox = svgElement.getBBox();
  const viewBox = svgElement.viewBox.baseVal;
  const width = viewBox?.width > 0 ? viewBox.width : bbox.width;
  const height = viewBox?.height > 0 ? viewBox.height : bbox.height;
  if (width <= 0 || height <= 0) {
    throw new Error("Diagram has no exportable dimensions.");
  }
  let scale = getPngExportScale(width, height);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Diagram is too large to export.");
  }
  const footerText = repository ? `gitdiagram.com/${repository}` : undefined;

  // A browser that cannot hold the canvas fails to encode it: try at half the
  // resolution before giving up.
  for (;;) {
    try {
      const png = await renderPng(
        svgElement,
        width,
        height,
        scale,
        backgroundColor,
        footerText,
      );
      downloadBlob(png, "diagram.png");
      return;
    } catch (error) {
      if (scale / 2 < 1) throw error;
      scale /= 2;
    }
  }
}

/** The Mermaid source with a comment line crediting its page. */
export function withGitDiagramCredit(diagram: string, repository: string) {
  return `%% Generated by https://gitdiagram.com/${repository}\n${diagram}`;
}
