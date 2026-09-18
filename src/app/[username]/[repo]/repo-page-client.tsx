"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ExternalLink, Key, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import type { DiagramStateResponse } from "~/features/diagram/types";
import { RepositoryWorkspace } from "~/components/generation/repository-workspace";
import { loadDiagramRenderer } from "~/components/generation/load-diagram-renderer";
import { useDiagram } from "~/hooks/useDiagram";
import { ApiKeyDialog } from "~/components/api-key-dialog";
import { useStarReminder } from "~/hooks/useStarReminder";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { isExampleRepo } from "~/lib/exampleRepos";
import { githubAccessTitle } from "~/features/diagram/github-access";
import { Button } from "~/components/ui/button";

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
  const [showGithubAccess, setShowGithubAccess] = useState(false);
  useStarReminder();
  const normalizedUsername = username.toLowerCase();
  const normalizedRepo = repo.toLowerCase();
  const repository = `${normalizedUsername}/${normalizedRepo}`;
  const {
    diagram,
    error,
    loading,
    lastGenerated,
    showApiKeyDialog,
    handleApiKeySaved,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
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
  const showApiKeyCta =
    state.errorCode === "RATE_LIMITED" ||
    Boolean(error?.includes("API key")) ||
    Boolean(state.error?.includes("API key"));
  const showGithubAccessCta = Boolean(githubAccessTitle(state.errorCode));

  useEffect(() => {
    if (hasDiagram || loading) void loadDiagramRenderer();
  }, [hasDiagram, loading]);
  useEffect(() => {
    if (!state.persistenceWarning) return;
    toast.warning("Diagram generated, but not saved", {
      description: state.persistenceWarning,
      duration: 8_000,
    });
  }, [state.persistenceWarning]);

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={300}>
      <main>
        <RepositoryWorkspace
          repository={repository}
          state={state}
          loading={loading}
          lastGenerated={lastGenerated}
          onRegenerate={() => void handleRegenerate()}
          onCancel={handleCancel}
          onRenderError={handleDiagramRenderError}
          regenerateDisabled={isExampleRepo(normalizedUsername, normalizedRepo)}
          recovery={
            <>
              {showGithubAccessCta && (
                <Button
                  type="button"
                  onClick={() => setShowGithubAccess(true)}
                  className="neo-button"
                >
                  <LockKeyhole aria-hidden="true" />
                  Add GitHub access
                </Button>
              )}
              {showApiKeyCta && (
                <Button
                  type="button"
                  onClick={handleOpenApiKeyDialog}
                  className="neo-button"
                >
                  <Key className="mr-2 inline h-4 w-4" aria-hidden="true" />
                  Use Your AI Key
                </Button>
              )}
              <a
                href={`https://github.com/${repository}`}
                target="_blank"
                rel="noopener noreferrer"
                className="neo-button-muted inline-flex items-center justify-center gap-2 font-medium"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open repository on GitHub
              </a>
            </>
          }
        />
        <ApiKeyDialog
          isOpen={showApiKeyDialog}
          onClose={handleCloseApiKeyDialog}
          onSaved={handleApiKeySaved}
        />
        {showGithubAccess && (
          <PrivateReposDialog
            isOpen
            repository={repository}
            onClose={() => setShowGithubAccess(false)}
            onSaved={() => void handleRegenerate()}
          />
        )}
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
