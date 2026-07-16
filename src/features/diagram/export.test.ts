import { afterEach, describe, expect, it, vi } from "vitest";

import { exportMermaidSvgAsPng } from "~/features/diagram/export";

describe("exportMermaidSvgAsPng", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves the 4x export while encoding asynchronously", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.getBBox = vi.fn(() => ({
      bottom: 50,
      height: 50,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }));
    svg.getScreenCTM = vi.fn(
      () => ({ a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 }) as DOMMatrix,
    );

    const canvas = document.createElement("canvas");
    const context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      scale: vi.fn(),
    };
    vi.spyOn(canvas, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const pngBlob = new Blob(["png"], { type: "image/png" });
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) => {
      queueMicrotask(() => callback(pngBlob));
    });
    const toDataUrl = vi.spyOn(canvas, "toDataURL");

    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) =>
      tagName === "canvas"
        ? canvas
        : createElement(tagName, options)) as typeof document.createElement);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:diagram-svg")
      .mockReturnValueOnce("blob:diagram-png");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });

    class ImageMock {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", ImageMock);

    await exportMermaidSvgAsPng(svg);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(context.scale).toHaveBeenCalledWith(4, 4);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.any(ImageMock),
      0,
      0,
      200,
      150,
    );
    expect(canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png",
    );
    expect(toDataUrl).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagram-svg");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagram-png");
  });
});
