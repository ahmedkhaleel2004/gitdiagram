"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Key } from "lucide-react";
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
  const showGithubAccessCta = [
    "REPOSITORY_NOT_FOUND",
    "GITHUB_AUTH_REQUIRED",
    "GITHUB_TOKEN_INVALID",
    "GITHUB_ACCESS_DENIED",
    "GITHUB_TREE_UNAVAILABLE",
  ].includes(state.errorCode ?? "");

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
                <button type="button" onClick={() => setShowGithubAccess(true)}>
                  GitHub Access
                </button>
              )}
              {showApiKeyCta && (
                <button type="button" onClick={handleOpenApiKeyDialog}>
                  <Key className="mr-2 inline h-4 w-4" aria-hidden="true" />
                  Use Your AI Key
                </button>
              )}
              <a
                href={`https://github.com/${repository}`}
                target="_blank"
                rel="noopener noreferrer"
              >
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
            onClose={() => setShowGithubAccess(false)}
            onSaved={() => void handleRegenerate()}
          />
        )}
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
