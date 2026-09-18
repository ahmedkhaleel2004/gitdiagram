import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Loading from "~/components/loading";
import { ArchitectureNotes } from "~/components/generation/architecture-notes";

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
  it("shows an accessible route loading state", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Opening your diagram",
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("keeps the saved overview optional and escapes markup", () => {
    render(
      <ArchitectureNotes
        streaming={false}
        text={
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
      <ArchitectureNotes streaming text="Earlier architecture" />,
    );
    openOverview();
    const pane = screen.getByTestId("generation-stream");
    Object.defineProperties(pane, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    rerender(
      <ArchitectureNotes streaming text="Earlier architecture\nMore notes" />,
    );
    await waitFor(() => expect(pane.scrollTop).toBe(1000));
    pane.scrollTop = 250;
    fireEvent.scroll(pane);
    rerender(
      <ArchitectureNotes
        streaming
        text="Earlier architecture\nMore notes\nLatest notes"
      />,
    );
    expect(pane.scrollTop).toBe(250);
    fireEvent.click(screen.getByRole("button", { name: "Follow latest" }));
    expect(pane.scrollTop).toBe(1000);
    expect(pageScroll).not.toHaveBeenCalled();
  });
});
