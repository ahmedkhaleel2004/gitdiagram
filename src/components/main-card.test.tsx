import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("accepts owner/repo shorthand input", () => {
    render(<MainCard isHome={false} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "facebook/react" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Diagram" }));

    expect(push).toHaveBeenCalledWith("/facebook/react");
    expect(
      screen.queryByText("Please enter a valid GitHub repository URL or owner/repo"),
    ).not.toBeInTheDocument();
  });
});
