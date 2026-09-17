"use client";

import { loadDiagramRenderer } from "~/components/generation/load-diagram-renderer";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Key } from "lucide-react";
import { toast } from "sonner";
import type { DiagramStateResponse } from "~/features/diagram/types";
import MainCard from "~/components/main-card";
import Loading from "~/components/loading";
import { DiagramResult } from "~/components/generation/diagram-result";
import { GenerationAuditPanel } from "~/components/generation-audit-panel";
import { useDiagram } from "~/hooks/useDiagram";
import { ApiKeyDialog } from "~/components/api-key-dialog";
import { useStarReminder } from "~/hooks/useStarReminder";
import { SponsorSlot } from "~/components/sponsor-slot";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";

const PrivateReposDialog = dynamic(
  () =>
    import("~/components/private-repos-dialog").then(
      (module) => module.PrivateReposDialog,
    ),
  { ssr: false },
);

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
  const [showGithubAccess, setShowGithubAccess] = useState(false);

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
    handleCancel,
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
  // Offer the personal-key escape hatch on any rate-limited generation, not
  // only when the error text happens to mention an API key.
  const showApiKeyCta =
    state.errorCode === "RATE_LIMITED" ||
    Boolean(error?.includes("API key")) ||
    Boolean(state.error?.includes("API key"));
  const showGithubAccessCta = [
    "REPOSITORY_NOT_FOUND",
    "GITHUB_AUTH_REQUIRED",
    "GITHUB_TOKEN_INVALID",
    "GITHUB_ACCESS_DENIED",
    "GITHUB_TREE_UNAVAILABLE",
  ].includes(state.errorCode ?? "");

  useEffect(() => {
    if (hasDiagram || loading) {
      void loadDiagramRenderer();
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

  const recoveryActions = (
    <>
      <Button
        onClick={() => void handleRegenerate()}
        className="neo-button px-4 py-2"
      >
        Try again
      </Button>
      {showGithubAccessCta && (
        <Button
          onClick={() => setShowGithubAccess(true)}
          className="neo-button px-4 py-2"
        >
          GitHub Access
        </Button>
      )}
      <a
        href={`https://github.com/${encodeURIComponent(normalizedUsername)}/${encodeURIComponent(normalizedRepo)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="neo-link self-center text-sm"
      >
        Open repository on GitHub
      </a>
      {showApiKeyCta && (
        <Button
          onClick={handleOpenApiKeyDialog}
          className="neo-button px-4 py-2"
        >
          <Key className="mr-2 h-5 w-5" />
          Use Your AI Key
        </Button>
      )}
    </>
  );

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
            costSummary={state.costSummary}
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
              repository={`${normalizedUsername}/${normalizedRepo}`}
              onCancel={handleCancel}
              status={state.status}
              startedAt={state.startedAt}
              lastActivityAt={state.lastActivityAt}
              sourceFileCount={state.sourceFileCount}
              explanation={state.explanation}
              graph={state.graph}
            />
          ) : (
            <div className="flex w-full flex-col items-center gap-8">
              {hasDiagram && (
                <>
                  <DiagramResult
                    diagram={diagram}
                    repository={`${normalizedUsername}/${normalizedRepo}`}
                    explanation={state.explanation}
                    graph={state.graph}
                    startedAt={state.startedAt}
                    zoomingEnabled={zoomingEnabled}
                    onRenderError={handleDiagramRenderError}
                    onRenderComplete={handleDiagramRenderComplete}
                  />
                  {diagramRendered && (
                    <SponsorSlot
                      surface="diagram"
                      className="mx-4 mb-8 max-w-5xl sm:mb-12"
                    />
                  )}
                </>
              )}
              {hasError && (
                <div className="flex w-full flex-col items-center gap-6">
                  {hasDiagram ? (
                    <>
                      <GenerationAuditPanel
                        audit={state.latestSessionAudit}
                        error={error || state.error}
                      />
                      <div className="flex flex-wrap justify-center gap-3">
                        {recoveryActions}
                      </div>
                    </>
                  ) : (
                    <Loading
                      status="error"
                      repository={`${normalizedUsername}/${normalizedRepo}`}
                      explanation={state.explanation}
                      error={error || state.error}
                      cancelled={state.errorCode === "GENERATION_CANCELLED"}
                      recovery={recoveryActions}
                    />
                  )}
                  {!hasDiagram && state.latestSessionAudit && (
                    <GenerationAuditPanel audit={state.latestSessionAudit} />
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
        {showGithubAccess && (
          <PrivateReposDialog
            isOpen
            onClose={() => setShowGithubAccess(false)}
            onSaved={() => void handleRegenerate()}
          />
        )}
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
