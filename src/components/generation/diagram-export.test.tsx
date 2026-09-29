import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagramExport } from "./diagram-export";
const { exportPng, capture } = vi.hoisted(() => ({
  exportPng: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("~/lib/analytics-client", () => ({ captureAnalyticsEvent: capture }));
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

  it("offers README embeds only for a stored public diagram", () => {
    render(<DiagramExport diagram="A-->B" getSvg={() => null} />);
    open();
    expect(
      screen.queryByRole("button", { name: "README picture" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "README badge" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      "README picture",
      "readme_picture",
      "[![Architecture diagram of acme/demo](https://gitdiagram.com/acme/demo/diagram.png)](https://gitdiagram.com/acme/demo?utm_source=readme&utm_medium=picture)",
    ],
    [
      "README badge",
      "readme_badge",
      "[![Architecture diagram](https://gitdiagram.com/diagram-badge.svg)](https://gitdiagram.com/acme/demo?utm_source=readme&utm_medium=badge)",
    ],
  ])(
    "copies the %s Markdown and counts it",
    async (label, method, markdown) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      render(
        <DiagramExport
          diagram="A-->B"
          getSvg={() => null}
          readme={{ owner: "acme", repo: "demo" }}
        />,
      );
      open();
      fireEvent.click(screen.getByRole("button", { name: label }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        `${label} copied`,
      );
      expect(writeText).toHaveBeenCalledWith(markdown);
      expect(capture).toHaveBeenCalledWith("diagram_shared", {
        method,
        repository: "acme/demo",
      });
    },
  );

  it("counts a copied Mermaid source without naming a private repository", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<DiagramExport diagram="A-->B" getSvg={() => null} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Copy Mermaid" }));
    await screen.findByText("Mermaid copied");
    expect(capture).toHaveBeenCalledWith("diagram_shared", {
      method: "mermaid",
      repository: null,
    });
  });
});
