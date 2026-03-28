import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import RepoPageClient from "./repo-page-client";

const useDiagram = vi.fn();

vi.mock("~/hooks/useDiagram", () => ({
  useDiagram: (...args: unknown[]) => useDiagram(...args),
}));

vi.mock("~/hooks/useStarReminder", () => ({
  useStarReminder: vi.fn(),
}));

vi.mock("~/components/main-card", () => ({
  default: () => <div data-testid="main-card" />,
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

vi.mock("~/components/api-key-button", () => ({
  ApiKeyButton: () => <button type="button">Use API Key</button>,
}));

describe("RepoPageClient", () => {
  it("renders the cached diagram before failure details", () => {
    useDiagram.mockReturnValue({
      diagram: "flowchart TD\nA-->B",
      error: "Latest regeneration failed.",
      loading: false,
      lastGenerated: undefined,
      showApiKeyDialog: false,
      handleCopy: vi.fn(),
      handleApiKeySubmit: vi.fn(),
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

    const diagram = screen.getByTestId("diagram");
    const audit = screen.getByTestId("audit");

    expect(diagram.compareDocumentPosition(audit)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
