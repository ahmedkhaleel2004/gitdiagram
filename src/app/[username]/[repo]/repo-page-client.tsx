"use client";

import { useState } from "react";
import type { DiagramStateResponse } from "~/features/diagram/types";
import MainCard from "~/components/main-card";
import Loading from "~/components/loading";
import MermaidChart from "~/components/mermaid-diagram";
import { GenerationAuditPanel } from "~/components/generation-audit-panel";
import { useDiagram } from "~/hooks/useDiagram";
import { ApiKeyDialog } from "~/components/api-key-dialog";
import { ApiKeyButton } from "~/components/api-key-button";
import { useStarReminder } from "~/hooks/useStarReminder";

type RepoPageClientProps = {
  username: string;
  repo: string;
  initialState?: DiagramStateResponse | null;
};

export default function RepoPageClient({
  username,
  repo,
  initialState = null,
}: RepoPageClientProps) {
  const [zoomingEnabled, setZoomingEnabled] = useState(false);

  useStarReminder();

  const normalizedUsername = username.toLowerCase();
  const normalizedRepo = repo.toLowerCase();

  const {
    diagram,
    error,
    loading,
    lastGenerated,
    showApiKeyDialog,
    handleCopy,
    handleApiKeySubmit,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    handleRegenerate,
    handleDiagramRenderError,
    state,
  } = useDiagram(normalizedUsername, normalizedRepo, initialState);

  const hasDiagram = Boolean(diagram);
  const hasError = Boolean(error || state.error);

  return (
    <div className="flex flex-col items-center p-4">
      <div className="flex w-full justify-center pt-8">
        <MainCard
          isHome={false}
          username={normalizedUsername}
          repo={normalizedRepo}
          hasDiagram={hasDiagram}
          onCopy={handleCopy}
          lastGenerated={lastGenerated}
          actualCost={
            state.costSummary?.kind === "actual"
              ? state.costSummary.display
              : undefined
          }
          onExportImage={handleExportImage}
          onRegenerate={handleRegenerate}
          zoomingEnabled={zoomingEnabled}
          onZoomToggle={() => setZoomingEnabled((prev) => !prev)}
          loading={loading}
        />
      </div>
      <div className="mt-8 flex w-full flex-col items-center gap-8">
        {loading ? (
          <Loading
            costSummary={state.costSummary}
            status={state.status}
            message={state.message}
            explanation={state.explanation}
            graph={state.graph}
            graphAttempts={state.graphAttempts}
            validationError={state.validationError}
            diagram={state.diagram}
          />
        ) : (
          <div className="flex w-full flex-col items-center gap-8">
            {hasDiagram && (
              <div className="flex w-full justify-center px-4">
                <MermaidChart
                  chart={diagram}
                  zoomingEnabled={zoomingEnabled}
                  onRenderError={handleDiagramRenderError}
                />
              </div>
            )}
            {hasError && (
              <div className="w-full max-w-5xl text-center">
                <GenerationAuditPanel
                  audit={state.latestSessionAudit}
                  error={error || state.error}
                />
                {(error?.includes("API key") ||
                  state.error?.includes("API key")) && (
                  <div className="mt-8 flex flex-col items-center gap-2">
                    <ApiKeyButton onClick={handleOpenApiKeyDialog} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ApiKeyDialog
        isOpen={showApiKeyDialog}
        onClose={handleCloseApiKeyDialog}
        onSubmit={handleApiKeySubmit}
      />
    </div>
  );
}
