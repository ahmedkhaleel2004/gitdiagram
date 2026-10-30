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

  describe("commits", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";

    function submit(repository: string, commit?: string) {
      render(<MainCard />);
      fireEvent.change(
        screen.getByRole("textbox", { name: "GitHub repository" }),
        { target: { value: repository } },
      );
      if (commit !== undefined) {
        fireEvent.change(
          screen.getByRole("textbox", { name: "Commit (optional)" }),
          { target: { value: commit } },
        );
      }
      fireEvent.click(screen.getByRole("button", { name: "Diagram" }));
    }

    it("offers an optional commit field next to the repository", () => {
      render(<MainCard />);

      const commit = screen.getByRole("textbox", { name: "Commit (optional)" });
      expect(commit).not.toBeRequired();
      expect(
        screen.getByRole("textbox", { name: "GitHub repository" }),
      ).toBeRequired();
    });

    it("opens the commit route for a repository and a commit", () => {
      submit("facebook/react", sha);

      expect(push).toHaveBeenCalledWith(`/facebook/react/commit/${sha}`);
    });

    it("accepts a short SHA and normalizes it", () => {
      submit("facebook/react", "  ABC1234  ");

      expect(push).toHaveBeenCalledWith("/facebook/react/commit/abc1234");
    });

    it("keeps opening the default branch when the commit field is empty", () => {
      submit("facebook/react", "   ");

      expect(push).toHaveBeenCalledWith("/facebook/react");
    });

    it("navigates to the commit route for a pasted GitHub commit url", () => {
      submit(`https://github.com/vercel/next.js/commit/${sha}`);

      expect(push).toHaveBeenCalledWith(`/vercel/next.js/commit/${sha}`);
    });

    it("handles a pasted commit url with a short SHA and a suffix", () => {
      submit("https://github.com/vercel/next.js/commit/ABC1234/files?w=1");

      expect(push).toHaveBeenCalledWith("/vercel/next.js/commit/abc1234");
    });

    it("lets the commit field win over the commit in a pasted url", () => {
      submit(`https://github.com/vercel/next.js/commit/${sha}`, "abc1234");

      expect(push).toHaveBeenCalledWith("/vercel/next.js/commit/abc1234");
    });

    it("still opens the default branch for other pasted GitHub pages", () => {
      submit("https://github.com/vercel/next.js/tree/canary/packages/next");

      expect(push).toHaveBeenCalledWith("/vercel/next.js");
    });

    it.each(["main", "abc12", "HEAD~1", `${sha}0`])(
      "does not navigate for the malformed commit %j and says why",
      (commit) => {
        submit("facebook/react", commit);

        expect(push).not.toHaveBeenCalled();
        const field = screen.getByRole("textbox", {
          name: "Commit (optional)",
        });
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(field).toHaveAccessibleDescription(
          /valid commit SHA.*at least 7/u,
        );
      },
    );

    it("rejects a malformed SHA in a pasted commit url", () => {
      submit("https://github.com/facebook/react/commit/not-a-sha");

      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(/valid commit SHA/u);
    });
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
