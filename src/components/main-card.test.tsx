import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MainCard from "~/components/main-card";
import { recordRecentDiagram } from "~/features/recent/recent-diagrams";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("~/lib/analytics-client", () => ({ captureAnalyticsEvent: capture }));

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
  }),
  usePathname: () => "/",
}));

describe("MainCard", () => {
  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    capture.mockReset();
  });

  it("accepts owner/repo shorthand input", () => {
    render(<MainCard />);

    const input = screen.getByRole("textbox", {
      name: "GitHub repository",
    });
    fireEvent.change(input, {
      target: { value: "facebook/react" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Diagram" }));

    expect(push).toHaveBeenCalledWith("/facebook/react");
    expect(
      screen.queryByText(
        "Please enter a valid GitHub repository URL or owner/repo",
      ),
    ).not.toBeInTheDocument();
  });

  it("associates invalid input feedback with the repository field", () => {
    render(<MainCard />);

    const input = screen.getByRole("textbox", {
      name: "GitHub repository",
    });
    fireEvent.change(input, { target: { value: "not-a-repository" } });
    fireEvent.click(screen.getByRole("button", { name: "Diagram" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Please enter a valid GitHub repository URL or owner/repo",
    );
  });

  it("lets example repositories navigate without submitting the required input", () => {
    render(<MainCard />);

    const exampleButton = screen.getByRole("button", { name: "FastAPI" });
    expect(exampleButton).toHaveAttribute("type", "button");

    fireEvent.click(exampleButton);

    expect(push).toHaveBeenCalledWith("/fastapi/fastapi");
    expect(
      screen.queryByText(
        "Please enter a valid GitHub repository URL or owner/repo",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows no recent row to a first-time visitor", () => {
    render(<MainCard />);
    expect(screen.queryByText("Recent:")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear recent diagrams" }),
    ).not.toBeInTheDocument();
  });

  it("offers recent public diagrams, newest first, and can forget them", () => {
    recordRecentDiagram({ owner: "acme", repo: "older" });
    recordRecentDiagram({ owner: "facebook", repo: "react" });
    render(<MainCard />);

    const chips = screen
      .getAllByRole("button")
      .filter((button) => button.title.includes("/"));
    expect(chips.map((chip) => chip.title)).toEqual([
      "facebook/react",
      "acme/older",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "facebook/react" }));
    expect(push).toHaveBeenCalledWith("/facebook/react");
    expect(capture).toHaveBeenCalledWith("recent_diagram_clicked", {
      repository: "facebook/react",
      position: 0,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Clear recent diagrams" }),
    );
    expect(screen.queryByText("Recent:")).not.toBeInTheDocument();
  });
});
