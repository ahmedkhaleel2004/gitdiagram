import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramStreamState } from "~/features/diagram/types";
import RepoPageClient from "./repo-page-client";
import controls from "~/components/generation/workspace.module.css";
const { warningToast } = vi.hoisted(() => ({ warningToast: vi.fn() }));
const useDiagram = vi.fn();
const retry = vi.fn();
const openKey = vi.fn();
vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { warning: warningToast },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("~/hooks/useDiagram", () => ({
  useDiagram: (...args: unknown[]) => useDiagram(...args),
}));
vi.mock("~/hooks/useStarReminder", () => ({ useStarReminder: vi.fn() }));
vi.mock("~/components/sponsor-slot", () => ({ SponsorSlot: () => null }));
vi.mock("~/components/mermaid-diagram", () => ({
  default: ({
    chart,
    onRenderComplete,
  }: {
    chart: string;
    onRenderComplete?: () => void;
  }) => (
    <div data-testid="diagram">
      {chart}
      <button onClick={onRenderComplete}>Finish rendering</button>
    </div>
  ),
}));
vi.mock("~/components/api-key-dialog", () => ({ ApiKeyDialog: () => null }));
function setup(state: DiagramStreamState) {
  useDiagram.mockReturnValue({
    diagram: state.diagram ?? "",
    error: state.error ?? "",
    loading: false,
    showApiKeyDialog: false,
    handleRegenerate: retry,
    handleCancel: vi.fn(),
    handleDiagramRenderError: vi.fn(),
    handleOpenApiKeyDialog: openKey,
    state,
  });
}
describe("RepoPageClient", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);
  it("keeps a cached diagram available alongside latest failure recovery", async () => {
    setup({
      status: "error",
      diagram: "flowchart TD\nA-->B",
      error: "Latest regeneration failed.",
    });
    render(<RepoPageClient username="Acme" repo="Demo" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Finish rendering",
        hidden: true,
      }),
    );
    expect(screen.getByTestId("diagram").parentElement).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    expect(screen.getByText("Latest regeneration failed.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("warns when a completed diagram could not be persisted", () => {
    const persistenceWarning =
      "The diagram was generated, but could not be cached.";
    setup({
      status: "complete",
      diagram: "flowchart TD\nA-->B",
      persistenceWarning,
    });
    render(<RepoPageClient username="Acme" repo="Demo" />);
    expect(warningToast).toHaveBeenCalledWith(
      "Diagram generated, but not saved",
      expect.objectContaining({ description: persistenceWarning }),
    );
  });
  it("offers the API key escape hatch on rate limits", () => {
    setup({
      status: "error",
      error: "Too many free generations. Try again later.",
      errorCode: "RATE_LIMITED",
    });
    render(<RepoPageClient username="Acme" repo="Demo" />);
    fireEvent.click(screen.getByRole("button", { name: /use your ai key/i }));
    expect(openKey).toHaveBeenCalledOnce();
  });
  it("does not suggest API keys for unrelated failures", () => {
    setup({ status: "error", error: "Something went wrong." });
    render(<RepoPageClient username="Acme" repo="Demo" />);
    expect(
      screen.queryByRole("button", { name: /use your ai key/i }),
    ).not.toBeInTheDocument();
  });
  it("shows final cost within Info", async () => {
    setup({
      status: "complete",
      diagram: "flowchart TD\nA-->B",
      costSummary: {
        kind: "estimate",
        approximate: true,
        amountUsd: 0.01,
        display: "$0.0100 USD",
        pricingModel: "gpt-5.6-terra",
        usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
      },
    });
    render(<RepoPageClient username="Acme" repo="Demo" />);
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(
      screen.queryByText("Estimated cost: $0.0100 USD"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Finish rendering",
        hidden: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.getByRole("region", { name: "Info" })).toHaveTextContent(
      "Estimated cost: $0.0100 USD",
    );
  });
  it("offers GitHub access recovery and retries the current repository", () => {
    setup({
      status: "error",
      error: "Check your GitHub access.",
      errorCode: "GITHUB_TOKEN_INVALID",
    });
    render(<RepoPageClient username="Acme" repo="Demo" />);
    expect(
      screen.getByRole("button", { name: "Add GitHub access" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /use your ai key/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open repository on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/acme/demo");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it.each([
    ["REPOSITORY_NOT_FOUND", "Private repository?"],
    ["GITHUB_AUTH_REQUIRED", "This repository needs GitHub access"],
    ["GITHUB_ACCESS_DENIED", "Your token needs repository access"],
    ["GITHUB_TOKEN_INVALID", "Update your GitHub token"],
  ])(
    "presents %s as an access step instead of a generation failure",
    (errorCode, title) => {
      setup({
        status: "error",
        errorCode,
        error: "Add GitHub access to continue.",
      });
      render(<RepoPageClient username="Acme" repo="Demo" />);
      expect(screen.getByRole("alert")).toHaveTextContent(title);
      expect(
        screen.queryByText("Couldn’t generate the diagram"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add GitHub access" }),
      ).toHaveClass(controls.actionButton!, controls.primary!);
      expect(
        screen.getByRole("link", { name: "Open repository on GitHub" }),
      ).toHaveClass(controls.actionButton!);
    },
  );
});
