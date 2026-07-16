import { useState, useEffect, useCallback } from "react";

import { getDiagramState } from "~/features/diagram/api";
import type {
  DiagramStateResponse,
  DiagramStreamState,
} from "~/features/diagram/types";
import { useDiagramStream } from "~/hooks/diagram/useDiagramStream";
import { useDiagramExport } from "~/hooks/diagram/useDiagramExport";
import { isExampleRepo } from "~/lib/exampleRepos";
import { storeOpenAiKey } from "~/lib/openai-key";

function toInitialStreamState(
  stateRecord: DiagramStateResponse | null | undefined,
): DiagramStreamState {
  if (!stateRecord?.diagram) {
    return { status: "idle" };
  }

  return {
    status: "complete",
    diagram: stateRecord.diagram,
    explanation: stateRecord.explanation ?? undefined,
    graph: stateRecord.graph ?? undefined,
    latestSessionAudit: stateRecord.latestSessionAudit ?? undefined,
    costSummary:
      stateRecord.latestSessionAudit?.finalCost ??
      stateRecord.latestSessionAudit?.estimatedCost,
  };
}

function getFailureMessage(
  audit: DiagramStateResponse["latestSessionAudit"],
): string | undefined {
  if (audit?.status !== "failed") {
    return undefined;
  }

  return audit.renderError ?? audit.compilerError ?? audit.validationError;
}

export function useDiagram(
  username: string,
  repo: string,
  initialState?: DiagramStateResponse | null,
  initialStateIsAuthoritative = false,
) {
  const [loading, setLoading] = useState<boolean>(
    !Boolean(initialState?.diagram),
  );
  const [lastGenerated, setLastGenerated] = useState<Date | undefined>(
    initialState?.lastSuccessfulAt
      ? new Date(initialState.lastSuccessfulAt)
      : undefined,
  );
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);

  const applyCompletedDiagram = useCallback(
    async ({ generatedAt }: { generatedAt?: string }) => {
      if (generatedAt) {
        setLastGenerated(new Date(generatedAt));
      }
      setLoading(false);
    },
    [],
  );

  const onStreamComplete = useCallback(
    async (result: {
      diagram: string;
      explanation: string;
      graph: DiagramStreamState["graph"];
      latestSessionAudit: DiagramStreamState["latestSessionAudit"];
      generatedAt?: string;
    }) => {
      await applyCompletedDiagram({
        generatedAt: result.generatedAt,
      });
    },
    [applyCompletedDiagram],
  );

  const onStreamError = useCallback((_message: string) => {
    setLoading(false);
  }, []);

  const { state, runGeneration, setState } = useDiagramStream({
    username,
    repo,
    onComplete: onStreamComplete,
    onError: onStreamError,
    initialState: toInitialStreamState(initialState),
  });

  const applyStoredState = useCallback(
    (stateRecord: DiagramStateResponse) => {
      const storedDiagram = stateRecord.diagram;
      const latestAudit = stateRecord.latestSessionAudit;
      const failureMessage = getFailureMessage(latestAudit);
      const shouldExposeFailure = !storedDiagram && Boolean(failureMessage);

      if (stateRecord.lastSuccessfulAt) {
        setLastGenerated(new Date(stateRecord.lastSuccessfulAt));
      }

      if (!storedDiagram && !latestAudit) {
        return false;
      }

      setState((prev) => ({
        ...prev,
        status: storedDiagram
          ? "complete"
          : shouldExposeFailure
            ? "error"
            : prev.status,
        diagram: storedDiagram ?? prev.diagram,
        explanation: stateRecord.explanation ?? prev.explanation,
        latestSessionAudit: latestAudit ?? prev.latestSessionAudit,
        costSummary:
          latestAudit?.finalCost ??
          latestAudit?.estimatedCost ??
          prev.costSummary,
        graph: stateRecord.graph ?? latestAudit?.graph ?? prev.graph,
        graphAttempts: latestAudit?.graphAttempts ?? prev.graphAttempts,
        failureStage: shouldExposeFailure
          ? latestAudit?.failureStage
          : prev.failureStage,
        validationError: shouldExposeFailure
          ? latestAudit?.validationError
          : prev.validationError,
        error: shouldExposeFailure
          ? failureMessage
          : storedDiagram
            ? undefined
            : prev.error,
      }));

      return Boolean(storedDiagram);
    },
    [setState],
  );

  const syncDiagramState = useCallback(
    async ({
      generateIfMissing,
      showLoading,
      clearError,
    }: {
      generateIfMissing: boolean;
      showLoading: boolean;
      clearError: boolean;
    }) => {
      if (showLoading) {
        setLoading(true);
      }

      if (clearError) {
        setState((prev) => ({
          ...prev,
          error: undefined,
        }));
      }

      try {
        const githubPat = localStorage.getItem("github_pat");
        const stateRecord = await getDiagramState(
          username,
          repo,
          githubPat ?? undefined,
        );
        const hasStoredDiagram = applyStoredState(stateRecord);

        if (hasStoredDiagram || !generateIfMissing) {
          return;
        }

        await runGeneration(githubPat ?? undefined);
      } catch {
        if (generateIfMissing) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: "Something went wrong. Please try again later.",
          }));
        }
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [applyStoredState, repo, runGeneration, setState, username],
  );

  const getDiagram = useCallback(async () => {
    await syncDiagramState({
      generateIfMissing: true,
      showLoading: true,
      clearError: true,
    });
  }, [syncDiagramState]);

  const refreshStoredDiagram = useCallback(async () => {
    await syncDiagramState({
      generateIfMissing: false,
      showLoading: false,
      clearError: false,
    });
  }, [syncDiagramState]);

  const handleRegenerate = useCallback(async () => {
    if (isExampleRepo(username, repo)) {
      return;
    }

    setLoading(true);
    setState((prev) => ({
      ...prev,
      error: undefined,
    }));

    const githubPat = localStorage.getItem("github_pat");

    try {
      await runGeneration(githubPat ?? undefined);
    } catch {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Something went wrong. Please try again later.",
      }));
    } finally {
      setLoading(false);
    }
  }, [repo, runGeneration, setState, username]);

  useEffect(() => {
    if (initialState?.diagram) {
      // Public server state is read through a tag-invalidated cache. Avoid
      // downloading that same artifact again unless a PAT means the user may
      // have a distinct private artifact for this repository.
      if (initialStateIsAuthoritative && !localStorage.getItem("github_pat")) {
        return;
      }
      void refreshStoredDiagram();
      return;
    }
    void getDiagram();
  }, [
    getDiagram,
    initialState?.diagram,
    initialStateIsAuthoritative,
    refreshStoredDiagram,
  ]);

  const diagram = state.diagram ?? "";
  const error = state.error ?? "";
  const { handleCopy, handleExportImage } = useDiagramExport(diagram);

  const handleApiKeySubmit = async (apiKey: string) => {
    setShowApiKeyDialog(false);
    setLoading(true);
    setState((prev) => ({
      ...prev,
      error: undefined,
    }));

    storeOpenAiKey(apiKey);

    const githubPat = localStorage.getItem("github_pat");
    try {
      await runGeneration(githubPat ?? undefined);
    } catch {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Failed to generate diagram with provided API key.",
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleCloseApiKeyDialog = () => {
    setShowApiKeyDialog(false);
  };

  const handleOpenApiKeyDialog = () => {
    setShowApiKeyDialog(true);
  };

  const handleDiagramRenderError = useCallback(
    (renderMessage: string) => {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: `Diagram render failed: ${renderMessage}`,
        failureStage: "browser_render",
        validationError: renderMessage,
      }));
    },
    [setState],
  );

  return {
    diagram,
    error,
    loading,
    lastGenerated,
    handleCopy,
    showApiKeyDialog,
    handleApiKeySubmit,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    handleRegenerate,
    handleDiagramRenderError,
    state: state as DiagramStreamState,
  };
}
