import { cleanup, act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagramResult } from "./diagram-result";

let complete: (() => void) | undefined;
let fail: ((message: string) => void) | undefined;
vi.mock("next/dynamic", () => ({
  default:
    () =>
    (props: {
      chart: string;
      onRenderComplete: () => void;
      onRenderError: (message: string) => void;
    }) => {
      complete = props.onRenderComplete;
      fail = props.onRenderError;
      return <div data-testid="chart">{props.chart}</div>;
    },
}));

afterEach(cleanup);

describe("diagram reveal", () => {
  it("keeps feedback visible until the renderer reports success, including changed diagrams", () => {
    const { rerender } = render(
      <DiagramResult diagram="A-->B" repository="acme/demo" />,
    );
    expect(
      screen.getByRole("region", { name: "Diagram generation" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chart").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    act(() => complete?.());
    expect(
      screen.queryByRole("region", { name: "Diagram generation" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Diagram ready")).toBeInTheDocument();
    rerender(<DiagramResult diagram="A-->C" repository="acme/demo" />);
    expect(
      screen.getByRole("region", { name: "Diagram generation" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chart").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("ends the loading state and exposes recovery when rendering fails", () => {
    const onError = vi.fn();
    render(
      <DiagramResult
        diagram="broken"
        repository="acme/demo"
        onRenderError={onError}
      />,
    );
    act(() => fail?.("Unable to render"));
    expect(
      screen.queryByRole("region", { name: "Diagram generation" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Diagram ready")).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("Unable to render");
  });
});
