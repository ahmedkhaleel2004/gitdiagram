"use client";

import { useState } from "react";
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
};

export default function RepoPageClient({ username, repo }: RepoPageClientProps) {
  const [zoomingEnabled, setZoomingEnabled] = useState(false);

  useStarReminder();

  const normalizedUsername = username.toLowerCase();
  const normalizedRepo = repo.toLowerCase();

  const {
    diagram,
    error,
    loading,
    lastGenerated,
    cost,
    showApiKeyDialog,
    handleCopy,
    handleApiKeySubmit,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    handleRegenerate,
    handleDiagramRenderError,
    state,
  } = useDiagram(normalizedUsername, normalizedRepo);

  return (
    <div className="flex flex-col items-center p-4">
      <div className="flex w-full justify-center pt-8">
        <MainCard
          isHome={false}
          username={normalizedUsername}
          repo={normalizedRepo}
          hasDiagram={Boolean(diagram)}
          onCopy={handleCopy}
          lastGenerated={lastGenerated}
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
            cost={cost}
            status={state.status}
            message={state.message}
            explanation={state.explanation}
            graph={state.graph}
            graphAttempts={state.graphAttempts}
            validationError={state.validationError}
            diagram={state.diagram}
          />
        ) : error || state.error ? (
          <div className="mt-12 text-center">
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
            {diagram && (
              <div className="mt-8 flex w-full justify-center px-4">
                <MermaidChart
                  chart={diagram}
                  zoomingEnabled={zoomingEnabled}
                  onRenderError={handleDiagramRenderError}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex w-full justify-center px-4">
            <MermaidChart
              chart={diagram}
              zoomingEnabled={zoomingEnabled}
              onRenderError={handleDiagramRenderError}
            />
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
