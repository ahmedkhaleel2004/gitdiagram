import { useState, useEffect, useCallback, useRef } from "react";

import { getCredentialStatus } from "~/features/credentials/api";
import { getDiagramState } from "~/features/diagram/api";
import type {
  DiagramStateResponse,
  DiagramStreamState,
} from "~/features/diagram/types";
import { useDiagramStream } from "~/hooks/diagram/useDiagramStream";
import { useDiagramExport } from "~/hooks/diagram/useDiagramExport";
import { isExampleRepo } from "~/lib/exampleRepos";

type DiagramStateSyncMode = "foreground" | "background";

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
  const foregroundOperationRef = useRef<{
    activeId: number | null;
    nextId: number;
  }>({
    activeId: null,
    nextId: 0,
  });
  const backgroundSyncRevisionRef = useRef(0);

  const onStreamComplete = useCallback(
    async (result: {
      diagram: string;
      explanation: string;
      graph: DiagramStreamState["graph"];
      latestSessionAudit: DiagramStreamState["latestSessionAudit"];
      generatedAt?: string;
    }) => {
      if (result.generatedAt) {
        setLastGenerated(new Date(result.generatedAt));
      }
    },
    [],
  );

  const beginForegroundOperation = useCallback(() => {
    const operationId = foregroundOperationRef.current.nextId + 1;
    foregroundOperationRef.current = {
      activeId: operationId,
      nextId: operationId,
    };
    backgroundSyncRevisionRef.current += 1;
    setLoading(true);
    return operationId;
  }, []);

  const isActiveForegroundOperation = useCallback(
    (operationId: number) =>
      foregroundOperationRef.current.activeId === operationId,
    [],
  );

  const finishForegroundOperation = useCallback(
    (operationId: number) => {
      if (isActiveForegroundOperation(operationId)) {
        foregroundOperationRef.current.activeId = null;
        setLoading(false);
      }
    },
    [isActiveForegroundOperation],
  );

  const beginBackgroundSync = useCallback(() => {
    if (foregroundOperationRef.current.activeId !== null) {
      return null;
    }

    backgroundSyncRevisionRef.current += 1;
    return backgroundSyncRevisionRef.current;
  }, []);

  const isActiveBackgroundSync = useCallback((revision: number) => {
    return (
      foregroundOperationRef.current.activeId === null &&
      backgroundSyncRevisionRef.current === revision
    );
  }, []);

  const { state, runGeneration, setState } = useDiagramStream({
    username,
    repo,
    onComplete: onStreamComplete,
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
    async (mode: DiagramStateSyncMode) => {
      const foregroundOperationId =
        mode === "foreground" ? beginForegroundOperation() : null;
      const backgroundSyncRevision =
        mode === "background" ? beginBackgroundSync() : null;

      if (mode === "background" && backgroundSyncRevision === null) {
        return;
      }

      const isCurrentSync = () =>
        mode === "foreground"
          ? foregroundOperationId !== null &&
            isActiveForegroundOperation(foregroundOperationId)
          : backgroundSyncRevision !== null &&
            isActiveBackgroundSync(backgroundSyncRevision);

      if (mode === "foreground") {
        setState((prev) => ({
          ...prev,
          error: undefined,
        }));
      }

      try {
        const stateRecord = await getDiagramState(username, repo);
        if (!isCurrentSync()) {
          return;
        }
        const hasStoredDiagram = applyStoredState(stateRecord);

        if (hasStoredDiagram || mode === "background") {
          return;
        }

        await runGeneration();
      } catch {
        if (mode === "foreground" && isCurrentSync()) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: "Something went wrong. Please try again later.",
          }));
        }
      } finally {
        if (foregroundOperationId !== null) {
          finishForegroundOperation(foregroundOperationId);
        }
      }
    },
    [
      applyStoredState,
      beginBackgroundSync,
      beginForegroundOperation,
      finishForegroundOperation,
      isActiveBackgroundSync,
      isActiveForegroundOperation,
      repo,
      runGeneration,
      setState,
      username,
    ],
  );

  const getDiagram = useCallback(async () => {
    await syncDiagramState("foreground");
  }, [syncDiagramState]);

  const refreshStoredDiagram = useCallback(async () => {
    await syncDiagramState("background");
  }, [syncDiagramState]);

  const runGenerationOperation = useCallback(
    async (failureMessage: string) => {
      const operationId = beginForegroundOperation();
      setState((prev) => ({
        ...prev,
        error: undefined,
      }));

      try {
        await runGeneration();
      } catch {
        if (isActiveForegroundOperation(operationId)) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: failureMessage,
          }));
        }
      } finally {
        finishForegroundOperation(operationId);
      }
    },
    [
      beginForegroundOperation,
      finishForegroundOperation,
      isActiveForegroundOperation,
      runGeneration,
      setState,
    ],
  );

  const handleRegenerate = useCallback(async () => {
    if (isExampleRepo(username, repo)) {
      return;
    }

    await runGenerationOperation(
      "Something went wrong. Please try again later.",
    );
  }, [repo, runGenerationOperation, username]);

  useEffect(() => {
    if (initialState?.diagram) {
      if (!initialStateIsAuthoritative) {
        void refreshStoredDiagram();
        return;
      }

      // The secret itself is HttpOnly. Ask only whether a private credential
      // exists so an authoritative public artifact is not downloaded twice.
      let cancelled = false;
      void getCredentialStatus()
        .then((credentials) => {
          if (!cancelled && credentials.githubPatConfigured) {
            void refreshStoredDiagram();
          }
        })
        .catch(() => {
          if (!cancelled) {
            // Preserve private-repository reloads if status is unavailable.
            void refreshStoredDiagram();
          }
        });
      return () => {
        cancelled = true;
      };
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

  const handleApiKeySaved = async () => {
    await runGenerationOperation(
      "Failed to generate diagram with provided API key.",
    );
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
    handleApiKeySaved,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    handleRegenerate,
    handleDiagramRenderError,
    state,
  };
}
