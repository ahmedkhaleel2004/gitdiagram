import { useState, useEffect, useCallback } from "react";

import {
  getDiagramState,
  persistDiagramRenderError,
} from "~/app/_actions/cache";
import { type DiagramStreamState } from "~/features/diagram/types";
import { useDiagramStream } from "~/hooks/diagram/useDiagramStream";
import { useDiagramExport } from "~/hooks/diagram/useDiagramExport";
import { isExampleRepo } from "~/lib/exampleRepos";
import { storeOpenAiKey } from "~/lib/openai-key";

export function useDiagram(username: string, repo: string) {
  const [loading, setLoading] = useState<boolean>(true);
  const [lastGenerated, setLastGenerated] = useState<Date | undefined>();
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);

  const applyCompletedDiagram = useCallback(
    async ({
      generatedAt,
    }: {
      generatedAt?: string;
    }) => {
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
  });

  const getDiagram = useCallback(async () => {
    setLoading(true);
    setState((prev) => ({
      ...prev,
      error: undefined,
    }));

    try {
      const githubPat = localStorage.getItem("github_pat");
      const stateRecord = await getDiagramState(
        username,
        repo,
        githubPat ?? undefined,
      );

      if (stateRecord.lastSuccessfulAt) {
        setLastGenerated(new Date(stateRecord.lastSuccessfulAt));
      }
      if (stateRecord.latestSessionAudit) {
        const latestAudit = stateRecord.latestSessionAudit;
        setState((prev) => ({
          ...prev,
          status:
            stateRecord.diagram
              ? "complete"
              : latestAudit.status === "failed"
                ? "error"
                : prev.status,
          diagram: stateRecord.diagram ?? prev.diagram,
          explanation: stateRecord.explanation ?? prev.explanation,
          latestSessionAudit: latestAudit,
          costSummary:
            latestAudit.finalCost ?? latestAudit.estimatedCost ?? prev.costSummary,
          graph: latestAudit.graph ?? prev.graph,
          graphAttempts: latestAudit.graphAttempts ?? prev.graphAttempts,
          failureStage: latestAudit.failureStage ?? prev.failureStage,
          validationError: latestAudit.validationError ?? prev.validationError,
          error:
            latestAudit.status === "failed"
              ? latestAudit.renderError ??
                latestAudit.compilerError ??
                latestAudit.validationError
              : prev.error,
        }));
      } else {
        const storedDiagram = stateRecord.diagram;
        if (storedDiagram) {
          setState((prev) => ({
            ...prev,
            status: "complete",
            diagram: storedDiagram,
            explanation: stateRecord.explanation ?? prev.explanation,
            graph: stateRecord.graph ?? prev.graph,
          }));
        }
      }

      if (stateRecord.diagram) {
        setLoading(false);
        return;
      }
      await runGeneration(githubPat ?? undefined);
    } catch {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Something went wrong. Please try again later.",
      }));
      setLoading(false);
    }
  }, [repo, runGeneration, setState, username]);

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
      setLoading(false);
    }
  }, [repo, runGeneration, setState, username]);

  useEffect(() => {
    void getDiagram();
  }, [getDiagram]);

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
    async (renderMessage: string) => {
      const githubPat = localStorage.getItem("github_pat");
      await persistDiagramRenderError(
        username,
        repo,
        renderMessage,
        githubPat ?? undefined,
      );
      setState((prev) => ({
        ...prev,
        status: "error",
        error: `Diagram render failed: ${renderMessage}`,
        failureStage: "browser_render",
        validationError: renderMessage,
      }));
    },
    [repo, setState, username],
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
