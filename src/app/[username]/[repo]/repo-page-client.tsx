"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Key } from "lucide-react";
import { toast } from "sonner";
import type { DiagramStateResponse } from "~/features/diagram/types";
import MainCard from "~/components/main-card";
import Loading from "~/components/loading";
import { GenerationAuditPanel } from "~/components/generation-audit-panel";
import { useDiagram } from "~/hooks/useDiagram";
import { ApiKeyDialog } from "~/components/api-key-dialog";
import { useStarReminder } from "~/hooks/useStarReminder";
import { SponsorSlot } from "~/components/sponsor-slot";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";

const loadMermaidChart = () => import("~/components/mermaid-diagram");
const MermaidChart = dynamic(loadMermaidChart, {
  loading: () => (
    <div className="h-[70vh] max-h-[52rem] min-h-[22rem] w-full animate-pulse rounded-xl border border-black/12 bg-white/30 dark:border-white/12 dark:bg-white/[0.03]" />
  ),
});

type RepoPageClientProps = {
  username: string;
  repo: string;
  initialState?: DiagramStateResponse | null;
  initialStateIsAuthoritative?: boolean;
};

export default function RepoPageClient({
  username,
  repo,
  initialState = null,
  initialStateIsAuthoritative = false,
}: RepoPageClientProps) {
  const [zoomingEnabled, setZoomingEnabled] = useState(false);
  const [diagramRendered, setDiagramRendered] = useState(false);

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
    handleApiKeySaved,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    handleRegenerate,
    handleDiagramRenderError,
    state,
  } = useDiagram(
    normalizedUsername,
    normalizedRepo,
    initialState,
    initialStateIsAuthoritative,
  );

  const hasDiagram = Boolean(diagram);
  const hasError = Boolean(error || state.error);

  useEffect(() => {
    if (hasDiagram || loading) {
      void loadMermaidChart();
    }
  }, [hasDiagram, loading]);

  const handleDiagramRenderComplete = useCallback(() => {
    setDiagramRendered(true);
  }, []);

  useEffect(() => {
    setDiagramRendered(false);
  }, [diagram]);

  useEffect(() => {
    if (!state.persistenceWarning) {
      return;
    }

    toast.warning("Diagram generated, but not saved", {
      description: state.persistenceWarning,
      duration: 8_000,
    });
  }, [state.persistenceWarning]);

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={300}>
      <main className="flex flex-col items-center p-4">
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
                <>
                  <div className="flex w-full justify-center px-4">
                    <MermaidChart
                      chart={diagram}
                      zoomingEnabled={zoomingEnabled}
                      onRenderError={handleDiagramRenderError}
                      onRenderComplete={handleDiagramRenderComplete}
                    />
                  </div>
                  {diagramRendered && (
                    <SponsorSlot
                      surface="diagram"
                      className="mx-4 mb-8 max-w-5xl sm:mb-12"
                    />
                  )}
                </>
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
                      <Button
                        onClick={handleOpenApiKeyDialog}
                        className="neo-button px-4 py-2"
                      >
                        <Key className="mr-2 h-5 w-5" />
                        Use Your AI Key
                      </Button>
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
          onSaved={handleApiKeySaved}
        />
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
