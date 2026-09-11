import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MainCard from "~/components/main-card";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
  }),
}));

describe("MainCard", () => {
  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("accepts owner/repo shorthand input", () => {
    render(<MainCard isHome={false} />);

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
    render(<MainCard isHome={false} />);

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
});
