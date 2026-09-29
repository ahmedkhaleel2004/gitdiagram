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

const MOUSE_WHEEL_ZOOM_SPEED = 0.0015;
const TRACKPAD_PINCH_ZOOM_SPEED = 0.01;

interface ActiveDomSerializationPatch {
  depth: number;
  elementPrototype: typeof Element.prototype;
}

let activeDomSerializationPatch: ActiveDomSerializationPatch | null = null;

function serializeDomElement(this: Element) {
  return {
    tagName: this.tagName,
    id: this.id || undefined,
    className: typeof this.className === "string" ? this.className : undefined,
  };
}

function installDomSerializationPatch() {
  if (typeof window === "undefined") return () => {};

  const elementPrototype = window.Element?.prototype;
  if (!elementPrototype) return () => {};

  if (activeDomSerializationPatch?.elementPrototype === elementPrototype) {
    activeDomSerializationPatch.depth += 1;
    return () => {
      if (!activeDomSerializationPatch) return;
      activeDomSerializationPatch.depth -= 1;
      if (activeDomSerializationPatch.depth === 0) {
        delete (
          activeDomSerializationPatch.elementPrototype as typeof Element.prototype & {
            toJSON?: typeof serializeDomElement;
          }
        ).toJSON;
        activeDomSerializationPatch = null;
      }
    };
  }

  if ("toJSON" in elementPrototype) return () => {};

  Object.defineProperty(elementPrototype, "toJSON", {
    configurable: true,
    value: serializeDomElement,
  });
  activeDomSerializationPatch = {
    depth: 1,
    elementPrototype,
  };

  return () => {
    if (!activeDomSerializationPatch) return;
    activeDomSerializationPatch.depth -= 1;
    if (activeDomSerializationPatch.depth === 0) {
      delete (
        activeDomSerializationPatch.elementPrototype as typeof Element.prototype & {
          toJSON?: typeof serializeDomElement;
        }
      ).toJSON;
      activeDomSerializationPatch = null;
    }
  };
}

export async function withDomNodesSerializingSafely<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const restoreDomSerialization = installDomSerializationPatch();
  try {
    return await operation();
  } finally {
    restoreDomSerialization();
  }
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

  const delta = Math.max(-240, Math.min(240, normalizeWheelDelta(event)));
  return Math.exp(-delta * zoomSpeed);
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
  return absX > 0 || absY < 40 || !Number.isInteger(event.deltaY);
}

// The zoom buttons (and + / - keys) step by half again: from a whole-diagram
// fit, two presses make small text readable. Smaller steps drew rage clicks.
export const ZOOM_STEP = 1.5;
// Text smaller than this on screen cannot be read without zooming.
const MIN_READABLE_TEXT_PX = 12;
const DEFAULT_FONT_SIZE = 16;

/** How far the interactive viewer may zoom out and in, from its whole fit. */
export function getZoomLimits(fitScale: number) {
  // Very large diagrams fit at a tiny scale; still allow reading them up close.
  return { min: fitScale * 0.6, max: Math.max(fitScale * 12, 3) };
}

/** The typical label size, in the diagram's own units. */
export function getDiagramFontSize(svgElement: SVGSVGElement) {
  const sizes = Array.from(
    svgElement.querySelectorAll("g.node text, g.cluster-label text"),
    (element) => parseFloat(getComputedStyle(element).fontSize),
  )
    .filter((size) => Number.isFinite(size) && size > 0)
    .sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? DEFAULT_FONT_SIZE;
}

/**
 * The scale the interactive viewer opens at: the whole diagram when its text
 * is readable that way, otherwise just big enough to read (pan for the rest).
 */
export function getReadableScale(fitScale: number, fontSize: number) {
  const readable = MIN_READABLE_TEXT_PX / fontSize;
  if (!(readable > fitScale)) return fitScale;
  return Math.min(readable, getZoomLimits(fitScale).max);
}

/**
 * Where the flow starts: the horizontal centre of the topmost node, in the
 * diagram's own units (null when it cannot be measured).
 */
export function getTopNodeCenterX(svgElement: SVGSVGElement, width: number) {
  const svgRect = svgElement.getBoundingClientRect();
  if (!(svgRect.width > 0)) return null;
  let top: DOMRect | null = null;
  for (const node of svgElement.querySelectorAll("g.node")) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && (!top || rect.top < top.top)) top = rect;
  }
  if (!top) return null;
  return ((top.left + top.width / 2 - svgRect.left) / svgRect.width) * width;
}

// Normal reading follows the page's width and can scroll vertically. Fitting
// both axes here turned detailed maps into thumbnails on short laptop screens;
// the interactive viewer and browse previews have their own explicit fit mode.
export function getDefaultDiagramScale({
  containerWidth,
  contentWidth,
}: {
  containerWidth: number;
  contentWidth: number;
}) {
  if (contentWidth <= 0 || containerWidth <= 0) return 1;
  const scale = Math.min(containerWidth / contentWidth, 1.25);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
