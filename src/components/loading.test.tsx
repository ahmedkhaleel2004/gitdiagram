import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Loading from "~/components/loading";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function openOverview() {
  fireEvent.click(
    screen.getByRole("button", { name: "Architecture overview" }),
  );
}

describe("generation experience", () => {
  it("shows immediate activity without invented progress or notes", () => {
    render(
      <Loading status="started" repository="acme/demo" onCancel={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Reading repository");
    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stop generation" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Architecture overview" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("keeps a quiet model visibly connected when real keep-alives arrive", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"));
    const start = Date.now();
    const { rerender } = render(
      <Loading
        status="explanation"
        startedAt={start}
        lastActivityAt={start}
        sourceFileCount={12}
      />,
    );
    act(() => vi.advanceTimersByTime(40_000));
    expect(screen.getByText("Waiting for updates")).toBeInTheDocument();
    rerender(
      <Loading
        status="explanation"
        startedAt={start}
        lastActivityAt={Date.now()}
        sourceFileCount={12}
      />,
    );
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByLabelText("40 seconds elapsed")).toHaveTextContent(
      "0:40",
    );
    expect(
      screen.getByText("Analysis can take about a minute"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("12 source files · README and file tree"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Analyzing repository",
    );
  });

  it("keeps a graph retry in the build stage", () => {
    render(<Loading status="graph_retry" explanation="Overview" />);
    expect(screen.getByText("Build diagram").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Refining the diagram",
    );
  });

  it("keeps notes optional and escapes streamed markup", () => {
    render(
      <Loading
        status="explanation_chunk"
        explanation={
          "## Architecture\n<script>alert(1)</script>\n**Important and `src/app`**"
        }
      />,
    );
    expect(screen.queryByTestId("generation-stream")).not.toBeInTheDocument();
    openOverview();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("src/app").tagName).toBe("CODE");
    openOverview();
    expect(screen.queryByTestId("generation-stream")).not.toBeInTheDocument();
  });

  it("follows streamed notes without scrolling the page or overriding a reader", async () => {
    const pageScroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = pageScroll;
    const { rerender } = render(
      <Loading status="explanation_chunk" explanation="Earlier architecture" />,
    );
    openOverview();
    const pane = screen.getByTestId("generation-stream");
    Object.defineProperties(pane, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    rerender(
      <Loading
        status="explanation_chunk"
        explanation="Earlier architecture\nMore notes"
      />,
    );
    await waitFor(() => expect(pane.scrollTop).toBe(1000));
    pane.scrollTop = 250;
    fireEvent.scroll(pane);
    rerender(
      <Loading
        status="explanation_chunk"
        explanation="Earlier architecture\nMore notes\nLatest notes"
      />,
    );
    expect(pane.scrollTop).toBe(250);
    fireEvent.click(screen.getByRole("button", { name: "Follow latest" }));
    expect(pane.scrollTop).toBe(1000);
    expect(pageScroll).not.toHaveBeenCalled();
  });

  it("replaces activity with recovery after a failure and preserves the overview", () => {
    const retry = vi.fn();
    render(
      <Loading
        status="error"
        error="Connection ended"
        explanation="Completed analysis"
        recovery={<button onClick={retry}>Try again</button>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Connection ended");
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    openOverview();
    expect(screen.getByText("Completed analysis")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("calls cancellation immediately", () => {
    const cancel = vi.fn();
    render(<Loading status="started" onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop generation" }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
