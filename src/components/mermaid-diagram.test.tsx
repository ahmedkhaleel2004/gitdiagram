import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import MermaidChart from "~/components/mermaid-diagram";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    registerLayoutLoaders: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
  },
}));

describe("MermaidChart", () => {
  it("renders chart container", () => {
    const { container } = render(
      <MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled={false} />,
    );

    expect(container.querySelector(".mermaid")).toBeInTheDocument();
    expect(screen.queryByText(/Mermaid render failed:/)).not.toBeInTheDocument();
  });
});
