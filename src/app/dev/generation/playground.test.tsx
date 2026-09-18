import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GenerationPlayground from "./playground";
import { ConceptWorkspace } from "./concept-workspace";
import type { Approach } from "./use-preview";

const renders = new Map<
  string,
  { onRenderComplete?: () => void; onRenderError?: (message: string) => void }
>();
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("~/components/generation/load-diagram-renderer", () => ({
  loadDiagramRenderer: vi.fn().mockResolvedValue(null),
}));
vi.mock("next/dynamic", () => ({
  default:
    () =>
    (props: {
      chart: string;
      onRenderComplete?: () => void;
      onRenderError?: (message: string) => void;
    }) => {
      renders.set(props.chart, props);
      return <div data-testid={`chart-${props.chart}`}>{props.chart}</div>;
    },
}));

afterEach(() => {
  cleanup();
  renders.clear();
  vi.useRealTimers();
});

describe("generation approach tester", () => {
  it("switches designs without losing the paused point or cancelling the run", () => {
    render(<GenerationPlayground />);
    fireEvent.change(screen.getByLabelText("Jump to stage"), {
      target: { value: "10" },
    });
    for (const name of ["Thread", "Canvas", "Inline"]) {
      fireEvent.click(screen.getByRole("radio", { name }));
      expect(screen.getByLabelText("Preview time")).toHaveValue("10");
      expect(
        screen.getByRole("heading", { name: "Understanding the architecture" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Stop generation" }),
      ).toBeInTheDocument();
    }
  });

  it("acknowledges immediately and distinguishes a healthy long wait from lost updates", () => {
    render(<GenerationPlayground />);
    fireEvent.change(screen.getByLabelText("Scenario"), {
      target: { value: "slow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(
      screen.getByRole("heading", { name: "Connecting to your repository" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jump to stage"), {
      target: { value: "40" },
    });
    expect(
      screen.getByText("Still working · receiving updates"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Waiting for an update")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Scenario"), {
      target: { value: "stalled" },
    });
    fireEvent.change(screen.getByLabelText("Jump to stage"), {
      target: { value: "40" },
    });
    expect(
      screen.getByRole("heading", { name: "Waiting for an update" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Still working · receiving updates"),
    ).not.toBeInTheDocument();
  });

  it("stops playback immediately and restarts a cancelled generation", () => {
    vi.useFakeTimers();
    render(<GenerationPlayground />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole("button", { name: "Stop generation" }));
    const stoppedAt = (
      screen.getByLabelText("Preview time") as HTMLInputElement
    ).value;
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText("Preview time")).toHaveValue(stoppedAt);
    expect(
      screen.getByRole("heading", { name: "Generation stopped" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      screen.getByRole("heading", { name: "Connecting to your repository" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Preview time")).toHaveValue("0");
  });
});

const base = {
  seconds: 26,
  started: true,
  paused: true,
  cancelled: false,
  stalled: false,
  previousDiagram: "previous",
  stream: { status: "complete" as const, diagram: "replacement" },
  onStart: vi.fn(),
  onCancel: vi.fn(),
  onRegenerate: vi.fn(),
};
describe.each<Approach>(["inline", "thread", "canvas"])(
  "%s result handoff",
  (approach) => {
    it("waits for a fresh render when another run returns identical diagram text", () => {
      const { rerender } = render(
        <ConceptWorkspace {...base} approach={approach} runId={1} />,
      );
      act(() => renders.get("replacement")?.onRenderComplete?.());
      expect(
        screen.getByRole("heading", { name: "Your diagram is ready" }),
      ).toBeInTheDocument();
      rerender(<ConceptWorkspace {...base} approach={approach} runId={2} />);
      expect(
        screen.getByRole("heading", { name: "Drawing your diagram" }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("chart-previous").parentElement,
      ).toHaveAttribute("aria-hidden", "false");
      act(() => renders.get("replacement")?.onRenderComplete?.());
      expect(
        screen.getByRole("heading", { name: "Your diagram is ready" }),
      ).toBeInTheDocument();
    });
    it("keeps the previous diagram usable until its replacement has actually rendered", () => {
      render(<ConceptWorkspace {...base} approach={approach} />);
      expect(
        screen.getByTestId("chart-previous").parentElement,
      ).toHaveAttribute("aria-hidden", "false");
      expect(
        screen.getByTestId("chart-replacement").parentElement,
      ).toHaveAttribute("aria-hidden", "true");
      expect(
        screen.getByRole("heading", { name: "Drawing your diagram" }),
      ).toBeInTheDocument();
      act(() => renders.get("replacement")?.onRenderComplete?.());
      expect(
        screen.getByTestId("chart-previous").parentElement,
      ).toHaveAttribute("aria-hidden", "true");
      expect(
        screen.getByTestId("chart-replacement").parentElement,
      ).toHaveAttribute("aria-hidden", "false");
      expect(
        screen.getByRole("heading", { name: "Your diagram is ready" }),
      ).toBeInTheDocument();
    });
    it("retains the previous diagram when the new render fails or the request is cancelled", () => {
      const { rerender } = render(
        <ConceptWorkspace {...base} approach={approach} />,
      );
      act(() => renders.get("replacement")?.onRenderError?.("render failed"));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn’t display the diagram",
      );
      expect(
        screen.getByTestId("chart-previous").parentElement,
      ).toHaveAttribute("aria-hidden", "false");
      rerender(<ConceptWorkspace {...base} approach={approach} cancelled />);
      expect(
        screen.getByRole("heading", { name: "Generation stopped" }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("chart-previous").parentElement,
      ).toHaveAttribute("aria-hidden", "false");
    });
  },
);
