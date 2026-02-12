import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import MermaidChart from "~/components/mermaid-diagram";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    contentLoaded: vi.fn(),
  },
}));

describe("MermaidChart", () => {
  it("renders chart container", () => {
    render(<MermaidChart chart="flowchart TD\nA-->B" zoomingEnabled={false} />);

    expect(
      screen.getByText((content) => content.includes("flowchart TD")),
    ).toBeInTheDocument();
  });
});
