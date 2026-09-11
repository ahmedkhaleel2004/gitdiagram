import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RepoPageClient from "./repo-page-client";

const { mainCardProps, warningToast } = vi.hoisted(() => ({
  mainCardProps: vi.fn(),
  warningToast: vi.fn(),
}));

const useDiagram = vi.fn();

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { warning: warningToast },
}));

vi.mock("~/hooks/useDiagram", () => ({
  useDiagram: (...args: unknown[]) => useDiagram(...args),
}));

vi.mock("~/hooks/useStarReminder", () => ({
  useStarReminder: vi.fn(),
}));

vi.mock("~/components/main-card", () => ({
  default: (props: unknown) => {
    mainCardProps(props);
    return <div data-testid="main-card" />;
  },
}));

vi.mock("~/components/loading", () => ({
  default: () => <div data-testid="loading" />,
}));

vi.mock("~/components/mermaid-diagram", () => ({
  default: ({ chart }: { chart: string }) => (
    <div data-testid="diagram">{chart}</div>
  ),
}));

vi.mock("~/components/generation-audit-panel", () => ({
  GenerationAuditPanel: ({ error }: { error?: string }) => (
    <div data-testid="audit">{error}</div>
  ),
}));

vi.mock("~/components/api-key-dialog", () => ({
  ApiKeyDialog: () => <div data-testid="api-key-dialog" />,
}));

describe("RepoPageClient", () => {
  beforeEach(() => {
    warningToast.mockClear();
    mainCardProps.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the cached diagram before failure details", async () => {
    useDiagram.mockReturnValue({
      diagram: "flowchart TD\nA-->B",
      error: "Latest regeneration failed.",
      loading: false,
      lastGenerated: undefined,
      showApiKeyDialog: false,
      handleCopy: vi.fn(),
      handleApiKeySaved: vi.fn(),
      handleCloseApiKeyDialog: vi.fn(),
      handleOpenApiKeyDialog: vi.fn(),
      handleExportImage: vi.fn(),
      handleRegenerate: vi.fn(),
      handleDiagramRenderError: vi.fn(),
      state: {
        costSummary: undefined,
        error: "Latest regeneration failed.",
        latestSessionAudit: {
          status: "failed",
        },
      },
    });

    render(<RepoPageClient username="Acme" repo="Demo" />);

    const diagram = await screen.findByTestId("diagram");
    const audit = screen.getByTestId("audit");

    expect(diagram.compareDocumentPosition(audit)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("warns when a completed diagram could not be persisted", () => {
    const persistenceWarning =
      "The diagram was generated, but could not be cached.";
    useDiagram.mockReturnValue({
      diagram: "flowchart TD\nA-->B",
      error: "",
      loading: false,
      lastGenerated: undefined,
      showApiKeyDialog: false,
      handleCopy: vi.fn(),
      handleApiKeySaved: vi.fn(),
      handleCloseApiKeyDialog: vi.fn(),
      handleOpenApiKeyDialog: vi.fn(),
      handleExportImage: vi.fn(),
      handleRegenerate: vi.fn(),
      handleDiagramRenderError: vi.fn(),
      state: {
        status: "complete",
        persistenceWarning,
      },
    });

    render(<RepoPageClient username="Acme" repo="Demo" />);

    expect(warningToast).toHaveBeenCalledWith(
      "Diagram generated, but not saved",
      expect.objectContaining({ description: persistenceWarning }),
    );
  });

  it("offers the API key CTA when a generation is rate-limited", () => {
    const rateLimitMessage =
      "Too many free generations from this network. Please try again in about 12 minutes.";
    useDiagram.mockReturnValue({
      diagram: "",
      error: rateLimitMessage,
      loading: false,
      lastGenerated: undefined,
      showApiKeyDialog: false,
      handleCopy: vi.fn(),
      handleApiKeySaved: vi.fn(),
      handleCloseApiKeyDialog: vi.fn(),
      handleOpenApiKeyDialog: vi.fn(),
      handleExportImage: vi.fn(),
      handleRegenerate: vi.fn(),
      handleDiagramRenderError: vi.fn(),
      state: {
        status: "error",
        error: rateLimitMessage,
        errorCode: "RATE_LIMITED",
      },
    });

    render(<RepoPageClient username="Acme" repo="Demo" />);

    expect(
      screen.getByRole("button", { name: /use your ai key/i }),
    ).toBeInTheDocument();
  });

  it("does not offer the API key CTA for unrelated failures", () => {
    const failureMessage = "Something went wrong. Please try again later.";
    useDiagram.mockReturnValue({
      diagram: "",
      error: failureMessage,
      loading: false,
      lastGenerated: undefined,
      showApiKeyDialog: false,
      handleCopy: vi.fn(),
      handleApiKeySaved: vi.fn(),
      handleCloseApiKeyDialog: vi.fn(),
      handleOpenApiKeyDialog: vi.fn(),
      handleExportImage: vi.fn(),
      handleRegenerate: vi.fn(),
      handleDiagramRenderError: vi.fn(),
      state: {
        status: "error",
        error: failureMessage,
      },
    });

    render(<RepoPageClient username="Acme" repo="Demo" />);

    expect(
      screen.queryByRole("button", { name: /use your ai key/i }),
    ).not.toBeInTheDocument();
  });

  it("preserves a final estimated cost after generation completes", () => {
    const costSummary = {
      kind: "estimate",
      approximate: true,
      amountUsd: 0.01,
      display: "$0.0100 USD",
      pricingModel: "gpt-5.6-terra",
      usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
    };
    useDiagram.mockReturnValue({
      diagram: "flowchart TD\nA-->B",
      error: "",
      loading: false,
      lastGenerated: undefined,
      showApiKeyDialog: false,
      handleCopy: vi.fn(),
      handleApiKeySaved: vi.fn(),
      handleCloseApiKeyDialog: vi.fn(),
      handleOpenApiKeyDialog: vi.fn(),
      handleExportImage: vi.fn(),
      handleRegenerate: vi.fn(),
      handleDiagramRenderError: vi.fn(),
      state: {
        status: "complete",
        costSummary,
      },
    });

    render(<RepoPageClient username="Acme" repo="Demo" />);

    expect(mainCardProps).toHaveBeenCalledWith(
      expect.objectContaining({ costSummary }),
    );
  });
});
