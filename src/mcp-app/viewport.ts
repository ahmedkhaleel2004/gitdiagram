import {
  clampViewState,
  getDiagramFontSize,
  getDistanceBetweenPointers,
  getPinchScaleFactor,
  getPointerMidpoint,
  getReadableScale,
  getSvgDimensions,
  getTopNodeCenterX,
  getTrackedPointerPair,
  getWheelZoomScaleFactor,
  getZoomLimits,
  ZOOM_STEP,
  type PointerCoordinates,
  type ViewState,
} from "~/components/mermaid-diagram-helpers";

// Pan and zoom for the diagram view inside chat apps: a small, framework-free
// version of the site's viewer (src/hooks/use-mermaid-viewport.ts), built on
// the same helpers so it zooms and clamps the same way.

const FIT_PADDING = 16;
/** Pointer travel (px) past which a press is a drag, not a click. */
const DRAG_THRESHOLD = 4;

export interface Viewport {
  /** Fits the diagram: whole, or at a readable size on its first node. */
  fit(mode: "whole" | "readable"): void;
  /** Zooms around the stage's centre. */
  step(direction: 1 | -1): void;
  /** Whether the last press moved far enough to count as a drag. */
  consumeDrag(): boolean;
  /** Touch panning: off inline (the chat scrolls), on in fullscreen. */
  setTouchPanning(enabled: boolean): void;
  destroy(): void;
}

export function createViewport(
  stage: HTMLElement,
  canvas: HTMLElement,
): Viewport {
  let view: ViewState | null = null;
  let touchPanning = false;
  let dragged = false;
  let panStart: {
    x: number;
    y: number;
    view: ViewState;
  } | null = null;
  let pinch: {
    distance: number;
    view: ViewState;
    midpoint: PointerCoordinates;
  } | null = null;
  const pointers = new Map<number, PointerCoordinates>();

  const svg = () => canvas.querySelector("svg");

  function apply(next: ViewState) {
    view = next;
    canvas.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
  }

  function bounds() {
    return { width: stage.clientWidth, height: stage.clientHeight };
  }

  function place(scale: number, x: number, y: number) {
    if (!view) return;
    const { width, height } = bounds();
    const limits = getZoomLimits(view.fitScale);
    const nextScale = Math.min(limits.max, Math.max(limits.min, scale));
    const position = clampViewState({
      containerHeight: height,
      containerWidth: width,
      contentHeight: view.height,
      contentWidth: view.width,
      nextScale,
      nextX: x,
      nextY: y,
    });
    apply({ ...view, scale: nextScale, ...position });
  }

  /** Zooms by `factor` keeping the stage point (cx, cy) still. */
  function zoomAt(factor: number, cx: number, cy: number, from = view) {
    if (!from) return;
    const limits = getZoomLimits(from.fitScale);
    const scale = Math.min(
      limits.max,
      Math.max(limits.min, from.scale * factor),
    );
    const ratio = scale / from.scale;
    place(scale, cx - (cx - from.x) * ratio, cy - (cy - from.y) * ratio);
  }

  function fit(mode: "whole" | "readable") {
    const element = svg();
    if (!(element instanceof SVGSVGElement)) return;
    const { width, height } = getSvgDimensions(element);
    const stageSize = bounds();
    if (stageSize.width <= 0 || stageSize.height <= 0) return;
    // Mermaid sizes the SVG to its container; the transform does the sizing.
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.maxWidth = "none";
    const fitScale = Math.min(
      Math.max(stageSize.width - FIT_PADDING * 2, 1) / width,
      Math.max(stageSize.height - FIT_PADDING * 2, 1) / height,
    );
    const scale =
      mode === "readable"
        ? getReadableScale(fitScale, getDiagramFontSize(element))
        : fitScale;
    view = { fitScale, width, height, scale, x: 0, y: 0 };
    if (scale === fitScale) {
      apply({
        ...view,
        x: (stageSize.width - width * scale) / 2,
        y: (stageSize.height - height * scale) / 2,
      });
      return;
    }
    const topCenter = getTopNodeCenterX(element, width) ?? width / 2;
    place(scale, stageSize.width / 2 - topCenter * scale, FIT_PADDING);
  }

  function local(event: PointerEvent | WheelEvent): PointerCoordinates {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  const handles = (event: PointerEvent) =>
    event.pointerType !== "touch" || touchPanning;

  function onPointerDown(event: PointerEvent) {
    if (!view || !handles(event)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.set(event.pointerId, local(event));
    dragged = false;
    const pair = getTrackedPointerPair(pointers);
    if (pair) {
      panStart = null;
      pinch = {
        distance: getDistanceBetweenPointers(...pair),
        view,
        midpoint: getPointerMidpoint(...pair),
      };
    } else {
      const point = local(event);
      panStart = { ...point, view };
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, local(event));
    const pair = getTrackedPointerPair(pointers);
    if (pair && pinch) {
      dragged = true;
      const midpoint = getPointerMidpoint(...pair);
      const factor = getPinchScaleFactor(
        pinch.distance,
        getDistanceBetweenPointers(...pair),
      );
      const start = pinch.view;
      const limits = getZoomLimits(start.fitScale);
      const scale = Math.min(
        limits.max,
        Math.max(limits.min, start.scale * factor),
      );
      const ratio = scale / start.scale;
      place(
        scale,
        midpoint.x - (pinch.midpoint.x - start.x) * ratio,
        midpoint.y - (pinch.midpoint.y - start.y) * ratio,
      );
      return;
    }
    if (!panStart) return;
    const point = local(event);
    const dx = point.x - panStart.x;
    const dy = point.y - panStart.y;
    if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragged) {
      dragged = true;
      stage.setPointerCapture?.(event.pointerId);
      stage.dataset.dragging = "true";
    }
    place(panStart.view.scale, panStart.view.x + dx, panStart.view.y + dy);
  }

  function onPointerEnd(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      panStart = null;
      delete stage.dataset.dragging;
    }
  }

  function onWheel(event: WheelEvent) {
    // A plain scroll wheel scrolls the chat; pinch (ctrl) and ⌘-scroll zoom.
    if (!view || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const point = local(event);
    zoomAt(getWheelZoomScaleFactor(event), point.x, point.y);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "+" || event.key === "=") step(1);
    else if (event.key === "-" || event.key === "_") step(-1);
    else if (event.key === "0") fit("whole");
    else return;
    event.preventDefault();
  }

  function step(direction: 1 | -1) {
    const { width, height } = bounds();
    zoomAt(direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP, width / 2, height / 2);
  }

  let resizeFrame = 0;
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            if (view) place(view.scale, view.x, view.y);
          });
        });
  resizeObserver?.observe(stage);

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerEnd);
  stage.addEventListener("pointercancel", onPointerEnd);
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("keydown", onKeyDown);

  return {
    fit,
    step,
    consumeDrag() {
      const was = dragged;
      dragged = false;
      return was;
    },
    setTouchPanning(enabled) {
      touchPanning = enabled;
      stage.style.touchAction = enabled ? "none" : "pan-x pan-y";
    },
    destroy() {
      resizeObserver?.disconnect();
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerEnd);
      stage.removeEventListener("pointercancel", onPointerEnd);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("keydown", onKeyDown);
    },
  };
}
