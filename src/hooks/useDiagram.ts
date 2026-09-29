import { useState, useEffect, useCallback, useRef } from "react";

import { getCredentialStatus } from "~/features/credentials/api";
import {
  captureDiagramEvent,
  reportableRepo,
} from "~/features/diagram/analytics";
import {
  DiagramStreamHttpError,
  getDiagramState,
} from "~/features/diagram/api";
import type {
  DiagramStateResponse,
  DiagramStreamState,
  RepositoryVisibility,
} from "~/features/diagram/types";
import {
  type GenerationOutcome,
  useDiagramStream,
} from "~/hooks/diagram/useDiagramStream";
import { isExampleRepo } from "~/lib/exampleRepos";

type DiagramStateSyncMode = "foreground" | "background";

/** What started a generation: the page itself, or the visitor. */
type GenerationTrigger = "auto" | "regenerate" | "api_key";

interface GenerationAttempt {
  repository: string;
  startedAt: number;
  trigger: GenerationTrigger;
  settled: boolean;
}

/** What analytics knows about the repository on screen. */
interface RepositoryAnalytics {
  repository: string;
  visibility?: RepositoryVisibility;
  viewed: boolean;
  diagramSource?: "stored" | "generated";
  renderFailure?: string;
}

// Errors are reported by code; a thrown request carries no stream code.
function toFailureOutcome(error: unknown): GenerationOutcome {
  if (error instanceof DiagramStreamHttpError) {
    return {
      status: "error",
      errorCode: error.errorCode ?? `HTTP_${error.status}`,
      failureStage: "request",
    };
  }
  return {
    status: "error",
    errorCode: "STREAM_FAILED",
    failureStage: "stream",
  };
}

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

function toGenerationFailure(
  error: unknown,
  fallbackMessage: string,
): { error: string; errorCode?: string } {
  // Pre-stream HTTP rejections carry the server's own explanation (e.g. the
  // rate-limit wait time); surface it verbatim like SSE errors already are.
  if (error instanceof DiagramStreamHttpError) {
    return { error: error.message, errorCode: error.errorCode };
  }
  return { error: fallbackMessage };
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

  const { state, runGeneration, cancelGeneration, setState } = useDiagramStream(
    {
      username,
      repo,
      onComplete: onStreamComplete,
      initialState: toInitialStreamState(initialState),
    },
  );

  const repository = `${username}/${repo}`;
  const analyticsRef = useRef<RepositoryAnalytics>({
    repository,
    viewed: false,
  });
  const attemptRef = useRef<GenerationAttempt | null>(null);

  // Resets when the page moves to another repository without remounting.
  const repositoryAnalytics = useCallback(() => {
    if (analyticsRef.current.repository !== repository) {
      analyticsRef.current = { repository, viewed: false };
    }
    return analyticsRef.current;
  }, [repository]);

  const reportStoredView = useCallback(
    (visibility: RepositoryVisibility | undefined) => {
      const analytics = repositoryAnalytics();
      if (visibility) analytics.visibility = visibility;
      analytics.diagramSource = "stored";
      if (analytics.viewed) return;
      analytics.viewed = true;
      captureDiagramEvent("diagram_viewed", {
        source: "stored",
        repo: reportableRepo(repository, analytics.visibility),
        is_private: analytics.visibility !== "public",
      });
    },
    [repository, repositoryAnalytics],
  );

  const settleAttempt = useCallback(
    (attempt: GenerationAttempt, outcome: GenerationOutcome | undefined) => {
      // A run replaced by a newer one, or unmounted, reports nothing.
      if (attempt.settled || !outcome || outcome.status === "aborted") return;
      attempt.settled = true;
      const analytics = repositoryAnalytics();
      if (analytics.repository !== attempt.repository) return;
      if (outcome.visibility) analytics.visibility = outcome.visibility;
      const common = {
        repo: reportableRepo(attempt.repository, analytics.visibility),
        duration_ms: Math.max(0, Math.round(Date.now() - attempt.startedAt)),
        regenerate: attempt.trigger !== "auto",
        trigger: attempt.trigger,
      };
      if (outcome.status === "complete") {
        analytics.diagramSource = "generated";
        captureDiagramEvent("diagram_generated", {
          ...common,
          is_private: analytics.visibility !== "public",
          byok: outcome.usedOwnKey ?? false,
        });
        return;
      }
      captureDiagramEvent("diagram_failed", {
        ...common,
        error_code: outcome.errorCode ?? "UNKNOWN",
        stage: outcome.failureStage ?? "unknown",
      });
    },
    [repositoryAnalytics],
  );

  /** Runs one generation, reporting its start and how it ended once. */
  const runTrackedGeneration = useCallback(
    async (trigger: GenerationTrigger) => {
      const attempt: GenerationAttempt = {
        repository,
        startedAt: Date.now(),
        trigger,
        settled: false,
      };
      attemptRef.current = attempt;
      captureDiagramEvent("diagram_generation_started", {
        repo: reportableRepo(repository, repositoryAnalytics().visibility),
        regenerate: trigger !== "auto",
        trigger,
      });
      let outcome: GenerationOutcome | undefined;
      try {
        outcome = await runGeneration();
      } catch (error) {
        settleAttempt(attempt, toFailureOutcome(error));
        throw error;
      }
      settleAttempt(attempt, outcome);
    },
    [repository, repositoryAnalytics, runGeneration, settleAttempt],
  );

  const applyStoredState = useCallback(
    (stateRecord: DiagramStateResponse) => {
      const storedDiagram = stateRecord.diagram;
      const latestAudit = stateRecord.latestSessionAudit;
      const failureMessage = getFailureMessage(latestAudit);
      const shouldExposeFailure = !storedDiagram && Boolean(failureMessage);

      if (storedDiagram && stateRecord.visibility) {
        repositoryAnalytics().visibility = stateRecord.visibility;
      }

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
    [repositoryAnalytics, setState],
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
          status: "idle",
          error: undefined,
          errorCode: undefined,
        }));
      }

      const startedAt = Date.now();
      let generationStarted = false;
      try {
        const stateRecord = await getDiagramState(username, repo);
        if (!isCurrentSync()) {
          return;
        }
        const hasStoredDiagram = applyStoredState(stateRecord);

        if (hasStoredDiagram && mode === "foreground") {
          reportStoredView(stateRecord.visibility);
        }
        if (hasStoredDiagram || mode === "background") {
          return;
        }

        generationStarted = true;
        await runTrackedGeneration("auto");
      } catch (error) {
        if (mode === "foreground" && isCurrentSync()) {
          if (!generationStarted) {
            // The saved diagram could not be read, so nothing was shown.
            captureDiagramEvent("diagram_failed", {
              repo: reportableRepo(
                repository,
                repositoryAnalytics().visibility,
              ),
              error_code: "DIAGRAM_STATE_UNAVAILABLE",
              stage: "stored_state",
              duration_ms: Math.max(0, Date.now() - startedAt),
              regenerate: false,
              trigger: "auto",
            });
          }
          const failure = toGenerationFailure(
            error,
            "Something went wrong. Please try again later.",
          );
          setState((prev) => ({
            ...prev,
            status: "error",
            error: failure.error,
            errorCode: failure.errorCode,
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
      reportStoredView,
      repository,
      repositoryAnalytics,
      runTrackedGeneration,
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
    async (failureMessage: string, trigger: GenerationTrigger) => {
      const operationId = beginForegroundOperation();
      setState((prev) => ({
        ...prev,
        error: undefined,
      }));

      try {
        await runTrackedGeneration(trigger);
      } catch (error) {
        if (isActiveForegroundOperation(operationId)) {
          const failure = toGenerationFailure(error, failureMessage);
          setState((prev) => ({
            ...prev,
            status: "error",
            error: failure.error,
            errorCode: failure.errorCode,
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
      runTrackedGeneration,
      setState,
    ],
  );

  const handleRegenerate = useCallback(async () => {
    if (isExampleRepo(username, repo)) {
      // The example's Regenerate control stays disabled, but error recovery
      // must still reload its saved diagram after a failed or stopped lookup.
      if (state.status === "error") await getDiagram();
      return;
    }

    await runGenerationOperation(
      "Something went wrong. Please try again later.",
      "regenerate",
    );
  }, [getDiagram, repo, runGenerationOperation, state.status, username]);

  const handleCancel = useCallback(() => {
    // Also invalidate a still-pending cache lookup so it cannot start a new
    // paid generation after the user has pressed Stop.
    foregroundOperationRef.current.activeId = null;
    backgroundSyncRevisionRef.current += 1;
    const attempt = attemptRef.current;
    if (attempt) {
      settleAttempt(attempt, {
        status: "error",
        errorCode: "GENERATION_CANCELLED",
        failureStage: "cancelled",
      });
    }
    cancelGeneration();
    setLoading(false);
  }, [cancelGeneration, settleAttempt]);

  useEffect(() => {
    if (initialState?.diagram) {
      reportStoredView(
        initialStateIsAuthoritative ? "public" : initialState.visibility,
      );
      if (!initialStateIsAuthoritative) {
        void refreshStoredDiagram();
        return;
      }

      // The secret itself is HttpOnly. Ask only whether a private credential
      // exists so an authoritative public artifact is not downloaded twice.
      let cancelled = false;
      void getCredentialStatus()
        .then((credentials) => {
          if (
            !cancelled &&
            (credentials.githubPatConfigured || credentials.githubAppConnected)
          ) {
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
    initialState?.visibility,
    initialStateIsAuthoritative,
    refreshStoredDiagram,
    reportStoredView,
  ]);

  const diagram = state.diagram ?? "";
  const error = state.error ?? "";

  const handleApiKeySaved = async () => {
    await runGenerationOperation(
      "Failed to generate diagram with provided API key.",
      "api_key",
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
      const analytics = repositoryAnalytics();
      const failure = state.diagram ?? "";
      // Once per diagram text, however often the renderer retries it.
      if (analytics.renderFailure !== failure) {
        analytics.renderFailure = failure;
        const repoName = reportableRepo(repository, analytics.visibility);
        captureDiagramEvent("diagram_render_failed", {
          repo: repoName,
          is_private: analytics.visibility !== "public",
          source: analytics.diagramSource ?? "unknown",
          stage: "browser_render",
          // Mermaid's message can quote diagram text: public repos only.
          error_message: repoName ? renderMessage.slice(0, 200) : null,
        });
      }
      setState((prev) => ({
        ...prev,
        status: "error",
        error: `Diagram render failed: ${renderMessage}`,
        failureStage: "browser_render",
        validationError: renderMessage,
      }));
    },
    [repository, repositoryAnalytics, setState, state.diagram],
  );

  return {
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
  };
}
