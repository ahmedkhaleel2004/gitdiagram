import { afterEach, describe, expect, it, vi } from "vitest";

import {
  exportMermaidSvgAsPng,
  getExportFooter,
  getPngExportScale,
  withGitDiagramCredit,
} from "~/features/diagram/export";

function setup({
  width = 100,
  height = 50,
  failEncodes = 0,
}: { width?: number; height?: number; failEncodes?: number } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.getBBox = vi.fn(() => ({
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  }));

  const canvases: HTMLCanvasElement[] = [];
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    scale: vi.fn(),
  };
  const pngBlob = new Blob(["png"], { type: "image/png" });
  let failures = failEncodes;
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    if (tagName !== "canvas") return createElement(tagName, options);
    const canvas = createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) => {
      const fail = failures > 0;
      failures -= 1;
      queueMicrotask(() => callback(fail ? null : pngBlob));
    });
    canvases.push(canvas);
    return canvas;
  }) as typeof document.createElement);
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  let urls = 0;
  const createObjectURL = vi.fn(() => `blob:${(urls += 1)}`);
  const revokeObjectURL = vi.fn();
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  const sources: string[] = [];
  const blobs: Blob[] = [];
  const RealBlob = Blob;
  vi.stubGlobal(
    "Blob",
    class extends RealBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        if (options?.type?.startsWith("image/svg")) {
          sources.push(String(parts?.[0]));
          blobs.push(this);
        }
      }
    },
  );

  class ImageMock {
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", ImageMock);
  return {
    svg,
    canvases,
    context,
    click,
    createObjectURL,
    revokeObjectURL,
    sources,
    ImageMock,
  };
}

describe("exportMermaidSvgAsPng", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([undefined, "#1a1520"])(
    "uses intrinsic bounds and the %s background while encoding asynchronously",
    async (background) => {
      const page = setup();

      await exportMermaidSvgAsPng(page.svg, background);

      const [canvas] = page.canvases;
      expect(canvas!.width).toBe(400);
      expect(canvas!.height).toBe(200);
      expect(page.context.fillStyle).toBe(background ?? "white");
      expect(page.context.scale).toHaveBeenCalledWith(4, 4);
      expect(page.context.drawImage).toHaveBeenCalledWith(
        expect.any(page.ImageMock),
        0,
        0,
        100,
        50,
      );
      expect(page.context.fillText).not.toHaveBeenCalled();
      expect(page.click).toHaveBeenCalledTimes(1);
      expect(page.revokeObjectURL).toHaveBeenCalledTimes(2);
    },
  );

  it("renders at full resolution whatever size the page shows it at", async () => {
    // Zoomed out in the viewer or fitted to a phone, the page sizes the SVG
    // down; the export must not inherit that (GitHub issue #129).
    const page = setup({ width: 2000, height: 1000 });
    page.svg.style.width = "300px";
    page.svg.style.height = "150px";
    page.svg.style.maxWidth = "100%";
    page.svg.style.transform = "scale(0.2)";

    await exportMermaidSvgAsPng(page.svg, "white");

    const source = page.sources[0]!;
    expect(source).toContain('width="8000"');
    expect(source).toContain('height="4000"');
    expect(source).not.toContain("300px");
    expect(source).not.toContain("scale(0.2)");
    expect(page.canvases[0]!.width).toBe(8000);
    // The page's own element is untouched.
    expect(page.svg.style.width).toBe("300px");
  });

  it("adds a link strip under the diagram, in the background's own colors", async () => {
    const page = setup();
    await exportMermaidSvgAsPng(page.svg, "rgb(31, 38, 49)", "acme/demo");

    const footer = getExportFooter(100, 50);
    expect(page.canvases[0]!.height).toBe((50 + footer.height) * 4);
    // One fill covers diagram and strip alike.
    expect(page.context.fillRect).toHaveBeenCalledWith(
      0,
      0,
      400,
      (50 + footer.height) * 4,
    );
    expect(page.context.fillText).toHaveBeenCalledWith(
      "gitdiagram.com/acme/demo",
      100 - footer.fontSize * 1.2,
      50 + footer.height / 2,
    );
    expect(page.context.textAlign).toBe("right");
    // Light text on a dark background.
    expect(page.context.fillStyle).toBe("rgba(255, 255, 255, 0.6)");
  });

  it("uses muted dark text on a light background", async () => {
    const page = setup();
    await exportMermaidSvgAsPng(page.svg, "rgb(243, 232, 255)", "acme/demo");
    expect(page.context.fillStyle).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("halves the resolution when the browser cannot encode the canvas", async () => {
    const page = setup({ failEncodes: 1 });
    await exportMermaidSvgAsPng(page.svg, "white");
    expect(page.canvases.map((canvas) => canvas.width)).toEqual([400, 200]);
    expect(page.click).toHaveBeenCalledTimes(1);
  });

  it("gives up below one pixel per unit", async () => {
    const page = setup({ failEncodes: 10 });
    await expect(exportMermaidSvgAsPng(page.svg, "white")).rejects.toThrow(
      "Unable to encode diagram PNG.",
    );
    expect(page.canvases.map((canvas) => canvas.width)).toEqual([
      400, 200, 100,
    ]);
    expect(page.click).not.toHaveBeenCalled();
  });
});

describe("getPngExportScale", () => {
  it("renders ordinary diagrams at 4x", () => {
    expect(getPngExportScale(2500, 1800)).toBe(4);
    expect(getPngExportScale(4000, 3000)).toBeCloseTo(
      Math.sqrt(120_000_000 / (4000 * 3000)),
    );
  });

  it("keeps large diagrams at 2x or more, under 16k pixels a side", () => {
    expect(getPngExportScale(4400, 800)).toBeCloseTo(16_000 / 4400);
    expect(getPngExportScale(5000, 2400)).toBeGreaterThanOrEqual(2);
    expect(getPngExportScale(12_000, 1000) * 12_000).toBeLessThanOrEqual(
      16_000,
    );
  });

  it("respects a phone's smaller canvas budget", () => {
    const scale = getPngExportScale(2500, 1800, 16_000_000);
    expect(2500 * 1800 * scale ** 2).toBeLessThanOrEqual(16_000_000);
  });
});

describe("withGitDiagramCredit", () => {
  it("puts a Mermaid comment line on top", () => {
    expect(withGitDiagramCredit("flowchart TD\nA-->B", "acme/demo")).toBe(
      "%% Generated by https://gitdiagram.com/acme/demo\nflowchart TD\nA-->B",
    );
  });
});
