import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MermaidChart from "~/components/mermaid-diagram";

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    registerLayoutLoaders: vi.fn(),
    render: renderMock,
  },
}));

describe("MermaidChart", () => {
  beforeEach(() => {
    renderMock.mockClear();
  });

  it("renders chart container", () => {
    const { container } = render(
      <MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled={false} />,
    );

    expect(container.querySelector(".mermaid")).toBeInTheDocument();
    expect(screen.queryByText(/Mermaid render failed:/)).not.toBeInTheDocument();
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
});
