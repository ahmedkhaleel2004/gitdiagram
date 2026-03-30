import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrowseDiagramPreview } from "~/components/browse-diagram-preview";

describe("BrowseDiagramPreview", () => {
  it("keeps the loading state at the same reserved body height", () => {
    render(
      <BrowseDiagramPreview
        chart={null}
        repoLabel="google-deepmind/funsearch"
        status="loading"
      />,
    );

    expect(
      screen
        .getByTestId("mermaid-preview")
        .querySelector(".h-\\[248px\\]"),
    ).toBeInTheDocument();
  });
});
