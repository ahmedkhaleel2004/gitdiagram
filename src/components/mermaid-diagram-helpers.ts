export type ViewState = {
  fitScale: number;
  height: number;
  scale: number;
  width: number;
  x: number;
  y: number;
};

export type PointerCoordinates = {
  x: number;
  y: number;
};

export type PinchState = {
  startDistance: number;
  startView: ViewState;
  startX: number;
  startY: number;
};

const DEFAULT_DIAGRAM_VIEWPORT_HEIGHT_RATIO = 0.92;
const DEFAULT_DIAGRAM_MIN_HEIGHT = 560;
const DEFAULT_DIAGRAM_MAX_HEIGHT = 1280;
const TALL_DIAGRAM_THRESHOLD = 1.8;
const TALL_DIAGRAM_MAX_ASPECT_RATIO = 6;
const TALL_DIAGRAM_WIDE_TARGET = 540;
const TALL_DIAGRAM_NARROW_TARGET = 360;
const MOUSE_WHEEL_ZOOM_SPEED = 0.0015;
const TRACKPAD_PINCH_ZOOM_SPEED = 0.01;

let domToJsonPatched = false;

export function ensureDomNodesSerializeSafely() {
  if (domToJsonPatched || typeof window === "undefined") return;

  const elementProto = window.Element?.prototype;
  if (!elementProto || "toJSON" in elementProto) {
    domToJsonPatched = true;
    return;
  }

  Object.defineProperty(elementProto, "toJSON", {
    configurable: true,
    value: function toJSON(this: Element) {
      return {
        tagName: this.tagName,
        id: this.id || undefined,
        className:
          typeof this.className === "string" ? this.className : undefined,
      };
    },
  });

  domToJsonPatched = true;
}

export function createHiddenRenderTarget(width: number) {
  const renderTarget = document.createElement("div");
  renderTarget.setAttribute("aria-hidden", "true");
  renderTarget.style.position = "absolute";
  renderTarget.style.visibility = "hidden";
  renderTarget.style.pointerEvents = "none";
  renderTarget.style.overflow = "hidden";
  renderTarget.style.left = "0";
  renderTarget.style.top = "0";
  renderTarget.style.zIndex = "-1";
  renderTarget.style.width = `${Math.max(width, 1)}px`;
  document.body.append(renderTarget);
  return renderTarget;
}

export function clampViewState({
  nextScale,
  nextX,
  nextY,
  containerHeight,
  containerWidth,
  contentHeight,
  contentWidth,
}: {
  containerHeight: number;
  containerWidth: number;
  contentHeight: number;
  contentWidth: number;
  nextScale: number;
  nextX: number;
  nextY: number;
}) {
  const scaledWidth = contentWidth * nextScale;
  const scaledHeight = contentHeight * nextScale;
  const horizontalGutter = Math.max(32, Math.min(160, containerWidth * 0.12));
  const verticalGutter = Math.max(32, Math.min(160, containerHeight * 0.12));

  const x =
    scaledWidth <= containerWidth
      ? (containerWidth - scaledWidth) / 2
      : Math.max(
          containerWidth - scaledWidth - horizontalGutter,
          Math.min(horizontalGutter, nextX),
        );

  const y =
    scaledHeight <= containerHeight
      ? (containerHeight - scaledHeight) / 2
      : Math.max(
          containerHeight - scaledHeight - verticalGutter,
          Math.min(verticalGutter, nextY),
        );

  return { x, y };
}

export function getSvgDimensions(svgElement: SVGSVGElement) {
  const viewBox = svgElement.viewBox.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return {
      height: viewBox.height,
      width: viewBox.width,
    };
  }

  const bbox = svgElement.getBBox();
  return {
    height: Math.max(bbox.height, 1),
    width: Math.max(bbox.width, 1),
  };
}

export function getDistanceBetweenPointers(
  firstPointer: PointerCoordinates,
  secondPointer: PointerCoordinates,
) {
  return Math.hypot(
    secondPointer.x - firstPointer.x,
    secondPointer.y - firstPointer.y,
  );
}

export function getPointerMidpoint(
  firstPointer: PointerCoordinates,
  secondPointer: PointerCoordinates,
) {
  return {
    x: (firstPointer.x + secondPointer.x) / 2,
    y: (firstPointer.y + secondPointer.y) / 2,
  };
}

export function getTrackedPointerPair(
  pointers: Map<number, PointerCoordinates>,
) {
  const [firstPointer, secondPointer] = Array.from(pointers.values());
  if (!firstPointer || !secondPointer) return null;
  return [firstPointer, secondPointer] as const;
}

export function normalizeWheelDelta(
  event: Pick<WheelEvent, "deltaMode" | "deltaY">,
) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * 120;
  }

  return event.deltaY;
}

export function getWheelZoomScaleFactor(
  event: Pick<WheelEvent, "ctrlKey" | "metaKey" | "deltaMode" | "deltaY">,
) {
  const zoomSpeed =
    event.ctrlKey || event.metaKey
      ? TRACKPAD_PINCH_ZOOM_SPEED
      : MOUSE_WHEEL_ZOOM_SPEED;

  return Math.exp(-normalizeWheelDelta(event) * zoomSpeed);
}

export function getPinchScaleFactor(
  startDistance: number,
  currentDistance: number,
) {
  if (startDistance <= 0 || currentDistance <= 0) return 1;
  return currentDistance / startDistance;
}

export function isLikelyTrackpadGesture(
  event: Pick<
    WheelEvent,
    "ctrlKey" | "metaKey" | "deltaMode" | "deltaX" | "deltaY"
  >,
) {
  if (event.ctrlKey || event.metaKey) return false;
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false;

  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  return absX > 0 || absY < 40;
}

export function getDefaultDiagramScale({
  containerWidth,
  contentHeight,
  contentWidth,
  viewportHeight,
}: {
  containerWidth: number;
  contentHeight: number;
  contentWidth: number;
  viewportHeight: number;
}) {
  if (contentWidth <= 0 || contentHeight <= 0 || containerWidth <= 0) {
    return 1;
  }

  const readableHeight = Math.max(
    DEFAULT_DIAGRAM_MIN_HEIGHT,
    Math.min(
      DEFAULT_DIAGRAM_MAX_HEIGHT,
      viewportHeight * DEFAULT_DIAGRAM_VIEWPORT_HEIGHT_RATIO,
    ),
  );

  const scale = Math.min(
    containerWidth / contentWidth,
    readableHeight / contentHeight,
  );

  if (!Number.isFinite(scale) || scale <= 0) {
    return 1;
  }

  const aspectRatio = contentHeight / contentWidth;
  if (aspectRatio <= TALL_DIAGRAM_THRESHOLD) {
    return scale;
  }

  const tallnessProgress = Math.min(
    1,
    Math.max(
      0,
      (aspectRatio - TALL_DIAGRAM_THRESHOLD) /
        (TALL_DIAGRAM_MAX_ASPECT_RATIO - TALL_DIAGRAM_THRESHOLD),
    ),
  );
  const targetRenderedWidth =
    TALL_DIAGRAM_WIDE_TARGET +
    (TALL_DIAGRAM_NARROW_TARGET - TALL_DIAGRAM_WIDE_TARGET) * tallnessProgress;
  const readableWidthScale =
    Math.min(containerWidth, targetRenderedWidth) / contentWidth;

  return Math.min(
    containerWidth / contentWidth,
    Math.max(scale, readableWidthScale),
  );
}
