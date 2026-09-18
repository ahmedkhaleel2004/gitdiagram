import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagramExport } from "./diagram-export";
const { exportPng } = vi.hoisted(() => ({ exportPng: vi.fn() }));
vi.mock("~/features/diagram/export", () => ({
  exportMermaidSvgAsPng: exportPng,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
}
describe("diagram export", () => {
  it("announces clipboard success only after the write resolves", async () => {
    let resolve!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <DiagramExport diagram={"flowchart TD\nA-->B"} getSvg={() => null} />,
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Copy Mermaid" }));
    expect(screen.queryByText("Mermaid copied")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Mermaid" })).toBeDisabled();
    resolve();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Mermaid copied",
    );
    expect(writeText).toHaveBeenCalledWith("flowchart TD\nA-->B");
  });
  it("reports a rejected clipboard write", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<DiagramExport diagram="A-->B" getSvg={() => null} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Copy Mermaid" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Copy failed. Try again.",
    );
    expect(screen.queryByText("Mermaid copied")).not.toBeInTheDocument();
  });
  it("exports the supplied visible diagram and reports failures", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    exportPng.mockRejectedValue(new Error("encode failed"));
    render(<DiagramExport diagram="A-->B" getSvg={() => svg} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    expect(exportPng).toHaveBeenCalledWith(svg, expect.any(String));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Download failed. Try again.",
    );
  });
});
