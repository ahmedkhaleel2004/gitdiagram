import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramStreamState } from "~/features/diagram/types";
import { RepositoryWorkspace } from "./repository-workspace";

const renders = new Map<
  string,
  {
    zoomingEnabled: boolean;
    onRenderComplete?: () => void;
    onRenderError?: (message: string) => void;
  }
>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("~/components/sponsor-slot", () => ({ SponsorSlot: () => null }));
vi.mock("next/dynamic", () => ({
  default:
    () =>
    (props: {
      chart: string;
      zoomingEnabled: boolean;
      onRenderComplete?: () => void;
      onRenderError?: (message: string) => void;
    }) => {
      renders.set(props.chart, props);
      return (
        <div data-testid={`chart-${props.chart}`} className="mermaid">
          <svg data-chart={props.chart} />
        </div>
      );
    },
}));
afterEach(() => {
  cleanup();
  renders.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});
const props = {
  repository: "acme/demo",
  loading: false,
  onRegenerate: vi.fn(),
  onCancel: vi.fn(),
  onRenderError: vi.fn(),
};
const cached: DiagramStreamState = {
  status: "complete",
  diagram: "old",
  explanation: "An API calls a database.",
  sourceFileCount: 12,
};
const finish = (chart: string) =>
  act(() => renders.get(chart)?.onRenderComplete?.());
const visible = (chart: string) =>
  expect(screen.getByTestId(`chart-${chart}`).parentElement).toHaveAttribute(
    "data-diagram-visible",
    "true",
  );

describe("repository generation workspace", () => {
  it("restores a saved diagram without replaying generation activity", () => {
    render(<RepositoryWorkspace {...props} state={cached} />);
    expect(
      screen.getByRole("heading", { name: "acme/demo", level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.queryByText("Drawing your diagram")).not.toBeInTheDocument();
    expect(screen.queryByText("12 source files read")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading diagram");
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(screen.queryByText("Loading diagram…")).not.toBeInTheDocument();
    expect(renders.get("old")?.zoomingEnabled).toBe(false);
    finish("old");
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Drawing your diagram" }),
    ).not.toBeInTheDocument();
    const activity = screen.getByRole("button", { name: "Info" });
    expect(activity).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(activity);
    expect(activity).toHaveAttribute("aria-expanded", "true");
    expect(
      document.getElementById(activity.getAttribute("aria-controls")!),
    ).toHaveTextContent("12 source files read");
    fireEvent.click(screen.getByRole("button", { name: "Enable zoom" }));
    expect(renders.get("old")?.zoomingEnabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Exit zoom" }));
    expect(renders.get("old")?.zoomingEnabled).toBe(false);
  });
  it("keeps saved generation time and cost in Info, including after a cancelled replacement", () => {
    const savedAt = new Date("2026-09-18T08:32:40Z");
    const cost = {
      kind: "actual" as const,
      approximate: false,
      amountUsd: 0.0076,
      display: "$0.0076 USD",
      pricingModel: "test",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    };
    const { rerender } = render(
      <RepositoryWorkspace
        {...props}
        lastGenerated={savedAt}
        state={{ ...cached, costSummary: cost }}
      />,
    );
    expect(
      screen.queryByText("Actual cost: $0.0076 USD"),
    ).not.toBeInTheDocument();
    finish("old");
    expect(
      screen.queryByRole("region", { name: "Info" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.getByRole("region", { name: "Info" })).toHaveTextContent(
      "Actual cost: $0.0076 USD",
    );
    expect(document.querySelector("time")).toHaveAttribute(
      "dateTime",
      savedAt.toISOString(),
    );
    expect(screen.getByRole("button", { name: "Info" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Actual cost: $0.0076 USD")).toBeVisible();
    rerender(
      <RepositoryWorkspace
        {...props}
        state={{
          status: "error",
          errorCode: "GENERATION_CANCELLED",
          startedAt: 20,
          costSummary: { ...cost, display: "$0.9999 USD" },
        }}
      />,
    );
    expect(screen.getByText("Actual cost: $0.0076 USD")).toBeVisible();
    expect(
      screen.queryByText("Actual cost: $0.9999 USD"),
    ).not.toBeInTheDocument();
  });
  it("uses a quiet loading state during a repository lookup", () => {
    render(
      <RepositoryWorkspace {...props} loading state={{ status: "idle" }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading diagram");
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Info" }),
    ).not.toBeInTheDocument();
  });
  it("presents the repository as a direct link without an edit control", () => {
    render(<RepositoryWorkspace {...props} state={cached} />);
    finish("old");
    expect(screen.getByRole("link", { name: "acme/demo" })).toHaveAttribute(
      "href",
      "https://github.com/acme/demo",
    );
    expect(
      screen.queryByRole("button", { name: "Change repository" }),
    ).not.toBeInTheDocument();
    visible("old");
  });
  it("keeps the previous result through streaming and waits for the replacement render", () => {
    const { rerender } = render(
      <RepositoryWorkspace {...props} state={cached} />,
    );
    finish("old");
    screen.getByRole("button", { name: "Regenerate" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(props.onRegenerate).toHaveBeenCalledOnce();
    rerender(
      <RepositoryWorkspace
        {...props}
        loading
        state={{ status: "started", startedAt: 10 }}
      />,
    );
    visible("old");
    expect(
      screen.getByRole("button", { name: "Stop generation" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Stop generation" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export" }),
    ).not.toBeInTheDocument();
    rerender(
      <RepositoryWorkspace
        {...props}
        state={{ status: "complete", startedAt: 10, diagram: "new" }}
      />,
    );
    visible("old");
    expect(screen.getByTestId("chart-new").parentElement).toHaveAttribute(
      "inert",
    );
    finish("new");
    visible("new");
    expect(screen.getByRole("button", { name: "Regenerate" })).toHaveFocus();
    expect(screen.queryByTestId("chart-old")).not.toBeInTheDocument();
  });
  it("requires a fresh render for identical output from another run", () => {
    const { rerender } = render(
      <RepositoryWorkspace {...props} state={cached} />,
    );
    finish("old");
    rerender(
      <RepositoryWorkspace {...props} state={{ ...cached, startedAt: 20 }} />,
    );
    expect(
      screen.getByRole("heading", { name: "Drawing your diagram" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("chart-old")).toHaveLength(2);
    finish("old");
    expect(screen.getAllByTestId("chart-old")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Diagram ready");
  });
  it.each(["GENERATION_CANCELLED", "STREAM_FAILED"])(
    "retains the previous diagram after %s",
    (errorCode) => {
      const { rerender } = render(
        <RepositoryWorkspace {...props} state={cached} />,
      );
      finish("old");
      rerender(
        <RepositoryWorkspace
          {...props}
          loading
          state={{ status: "started", startedAt: 20 }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Stop generation" }));
      expect(props.onCancel).toHaveBeenCalledOnce();
      rerender(
        <RepositoryWorkspace
          {...props}
          state={{
            status: "error",
            startedAt: 20,
            errorCode,
            error: "Connection interrupted.",
          }}
        />,
      );
      visible("old");
      expect(
        screen.getByRole("button", { name: "Export" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Regenerate" }),
      ).toBeInTheDocument();
    },
  );
  it("does not discard a valid result when its replacement fails to render", () => {
    const { rerender } = render(
      <RepositoryWorkspace {...props} state={cached} />,
    );
    finish("old");
    rerender(
      <RepositoryWorkspace
        {...props}
        state={{ status: "complete", startedAt: 20, diagram: "broken" }}
      />,
    );
    act(() => renders.get("broken")?.onRenderError?.("Invalid graph"));
    visible("old");
    expect(screen.queryByTestId("chart-broken")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn’t display the diagram",
    );
    expect(props.onRenderError).toHaveBeenCalledWith("Invalid graph");
  });
  it("distinguishes a healthy long wait from a connection without updates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(100_000));
    const { rerender } = render(
      <RepositoryWorkspace
        {...props}
        loading
        state={{
          status: "explanation_sent",
          startedAt: 60_000,
          lastActivityAt: 99_000,
        }}
      />,
    );
    expect(
      screen.getByText("Still working · receiving updates"),
    ).toBeInTheDocument();
    rerender(
      <RepositoryWorkspace
        {...props}
        loading
        state={{
          status: "explanation_sent",
          startedAt: 60_000,
          lastActivityAt: 61_000,
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Waiting for an update" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Still working · receiving updates"),
    ).not.toBeInTheDocument();
  });
  it("opens export with keyboard-accessible actions and restores focus on Escape", () => {
    render(<RepositoryWorkspace {...props} state={cached} />);
    finish("old");
    const trigger = screen.getByRole("button", { name: "Export" });
    fireEvent.click(trigger);
    expect(
      screen.getByRole("button", { name: "Download PNG" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy Mermaid" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("button", { name: "Download PNG" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it("keeps the diagram as the default view and opens the explainer video on request", () => {
    const { rerender } = render(
      <RepositoryWorkspace {...props} state={cached} />,
    );
    finish("old");
    expect(
      screen.queryByRole("button", { name: /^Video/ }),
    ).not.toBeInTheDocument();
    rerender(
      <RepositoryWorkspace
        {...props}
        state={cached}
        video={<p>explainer panel</p>}
      />,
    );
    const toggle = screen.getByRole("button", { name: /^Video/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("explainer panel")).not.toBeInTheDocument();
    visible("old");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      document.getElementById(toggle.getAttribute("aria-controls")!),
    ).toHaveTextContent("explainer panel");
    visible("old");
    fireEvent.click(toggle);
    expect(screen.queryByText("explainer panel")).not.toBeInTheDocument();
  });
  it("marks which phone column Export sits in, for its menu's direction", () => {
    const column = () =>
      screen
        .getByRole("button", { name: "Export" })
        .closest("[data-column]")
        ?.getAttribute("data-column");
    const { rerender } = render(
      <RepositoryWorkspace {...props} state={cached} />,
    );
    finish("old");
    expect(column()).toBe("left");
    rerender(
      <RepositoryWorkspace
        {...props}
        state={cached}
        video={<p>explainer panel</p>}
      />,
    );
    expect(column()).toBe("right");
  });
  it("retains example regeneration protection", () => {
    render(
      <RepositoryWorkspace {...props} regenerateDisabled state={cached} />,
    );
    finish("old");
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
  });
});
