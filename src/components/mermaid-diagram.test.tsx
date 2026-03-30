import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import MermaidChart, {
  getDefaultDiagramScale,
  getWheelZoomScaleFactor,
  isLikelyTrackpadGesture,
  normalizeWheelDelta,
} from "~/components/mermaid-diagram";

const { renderMock, resizeObserverObserveMock } = vi.hoisted(() => ({
  renderMock: vi.fn().mockResolvedValue({
    svg: "<svg viewBox='0 0 100 100'><rect width='100' height='100' /></svg>",
  }),
  resizeObserverObserveMock: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    registerLayoutLoaders: vi.fn(),
    render: renderMock,
  },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

describe("MermaidChart", () => {
  afterEach(() => {
    cleanup();
  });

  beforeAll(() => {
    class ResizeObserverMock {
      disconnect = vi.fn();
      observe = resizeObserverObserveMock;
      unobserve = vi.fn();
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    Object.defineProperty(HTMLDivElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        return {
          bottom: 600,
          height: 600,
          left: 0,
          right: 1000,
          top: 0,
          width: 1000,
          x: 0,
          y: 0,
        };
      },
    });
  });

  beforeEach(() => {
    renderMock.mockClear();
    resizeObserverObserveMock.mockClear();
  });

  it("renders chart container", () => {
    const { container } = render(
      <MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled={false} />,
    );

    expect(container.querySelector(".mermaid")).toBeInTheDocument();
    expect(screen.queryByText(/Mermaid render failed:/)).not.toBeInTheDocument();
  });

  it("can fit non-zoom diagrams into a fixed preview container", async () => {
    const { container } = render(
      <MermaidChart
        chart="flowchart TD\nA-->B"
        zoomingEnabled={false}
        fitToContainer
        containerClassName="h-[248px] overflow-hidden p-0"
      />,
    );

    await waitFor(() => {
      const mermaid = container.querySelector(".mermaid");
      expect(mermaid).toBeInstanceOf(HTMLDivElement);
      expect((mermaid as HTMLDivElement).style.transform).toContain("scale(");
      expect((mermaid as HTMLDivElement).style.transform).not.toContain(
        "translate3d(0px, 0px, 0)",
      );
    });
  });

  it("renders into a hidden staging element before updating the visible container", async () => {
    const { container } = render(
      <MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled={false} />,
    );

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalled();
    });

    const visibleMermaid = container.querySelector(".mermaid");
    const renderTarget = renderMock.mock.calls.at(-1)?.[2];

    expect(renderTarget).toBeInstanceOf(HTMLDivElement);
    expect(renderTarget).not.toBe(visibleMermaid);
    expect(renderTarget).toHaveStyle({
      position: "absolute",
      visibility: "hidden",
      pointerEvents: "none",
    });
  });

  it("shows custom controls when interactive mode is enabled", async () => {
    const { container } = render(
      <MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled />,
    );

    await waitFor(() => {
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    expect(screen.getByRole("region", { name: /interactive diagram viewer/i }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fit/i })).toBeInTheDocument();
    expect(resizeObserverObserveMock).toHaveBeenCalled();
    expect(container.querySelector(".select-none")).toBeInTheDocument();
  });

  it("pans the diagram after zooming in", async () => {
    const { container } = render(
      <MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled />,
    );

    await waitFor(() => {
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    const mermaid = container.querySelector(".mermaid");
    expect(mermaid).toBeInstanceOf(HTMLDivElement);

    fireEvent.click(screen.getByLabelText("Zoom in"));

    await waitFor(() => {
      expect(screen.getByText("118%")).toBeInTheDocument();
    });

    const initialTransform = (mermaid as HTMLDivElement).style.transform;
    const interactionLayer = (mermaid as HTMLDivElement).parentElement;
    expect(interactionLayer).toBeInstanceOf(HTMLDivElement);

    fireEvent.wheel(interactionLayer as HTMLDivElement, {
      deltaX: 12,
      deltaY: 30,
    });

    await waitFor(() => {
      expect((mermaid as HTMLDivElement).style.transform).not.toBe(initialTransform);
    });
  });

  it("treats desktop wheel input as zoom and small pixel deltas as trackpad pan", () => {
    expect(
      isLikelyTrackpadGesture({
        ctrlKey: false,
        deltaMode: 1,
        deltaX: 0,
        deltaY: -3,
        metaKey: false,
      }),
    ).toBe(false);

    expect(
      isLikelyTrackpadGesture({
        ctrlKey: false,
        deltaMode: 0,
        deltaX: 4,
        deltaY: 18,
        metaKey: false,
      }),
    ).toBe(true);

    expect(
      normalizeWheelDelta({
        deltaMode: 1,
        deltaY: -3,
      }),
    ).toBe(-48);

    expect(
      getWheelZoomScaleFactor({
        ctrlKey: true,
        deltaMode: 0,
        deltaY: -8,
        metaKey: false,
      }),
    ).toBeGreaterThan(
      getWheelZoomScaleFactor({
        ctrlKey: false,
        deltaMode: 0,
        deltaY: -8,
        metaKey: false,
      }),
    );
  });

  it("keeps tall default diagrams readable instead of shrinking them to viewport height", () => {
    expect(
      getDefaultDiagramScale({
        containerWidth: 1000,
        contentHeight: 1600,
        contentWidth: 320,
        viewportHeight: 800,
      }),
    ).toBeCloseTo(1.26);

    expect(
      getDefaultDiagramScale({
        containerWidth: 1000,
        contentHeight: 400,
        contentWidth: 1600,
        viewportHeight: 800,
      }),
    ).toBeCloseTo(0.625);
  });

  it("zooms the diagram with the toolbar controls", async () => {
    render(<MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled />);

    await waitFor(() => {
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Zoom in"));

    await waitFor(() => {
      expect(screen.getByText("118%")).toBeInTheDocument();
    });
  });

  it("resets back to fit when the fit button is pressed", async () => {
    const { container } = render(
      <MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled />,
    );

    await waitFor(() => {
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Zoom in"));

    await waitFor(() => {
      expect(screen.getByText("118%")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /fit/i }));

    await waitFor(() => {
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    const mermaid = container.querySelector(".mermaid");
    expect(mermaid).toBeInstanceOf(HTMLDivElement);
    expect((mermaid as HTMLDivElement).style.transform).not.toContain(
      "translate3d(0px, 0px, 0)",
    );
  });
});
