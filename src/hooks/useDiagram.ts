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
  const [diagram, setDiagram] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastGenerated, setLastGenerated] = useState<Date | undefined>();
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);

  const applyCompletedDiagram = useCallback(
    async ({
      diagram: nextDiagram,
      generatedAt,
    }: {
      diagram: string;
      generatedAt?: string;
    }) => {
      setDiagram(nextDiagram);
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
        diagram: result.diagram,
        generatedAt: result.generatedAt,
      });
    },
    [applyCompletedDiagram],
  );

  const onStreamError = useCallback((message: string) => {
    setError(message);
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
    setError("");

    try {
      const githubPat = localStorage.getItem("github_pat");
      const stateRecord = await getDiagramState(
        username,
        repo,
        githubPat ?? undefined,
      );

      if (stateRecord.diagram) {
        setDiagram(stateRecord.diagram);
      }
      if (stateRecord.lastSuccessfulAt) {
        setLastGenerated(new Date(stateRecord.lastSuccessfulAt));
      }
      if (stateRecord.latestSessionAudit) {
        const latestAudit = stateRecord.latestSessionAudit;
        setState((prev) => ({
          ...prev,
          latestSessionAudit: latestAudit,
          costSummary:
            latestAudit.finalCost ?? latestAudit.estimatedCost ?? prev.costSummary,
          graph: latestAudit.graph ?? prev.graph,
          graphAttempts: latestAudit.graphAttempts ?? prev.graphAttempts,
          failureStage: latestAudit.failureStage ?? prev.failureStage,
          validationError: latestAudit.validationError ?? prev.validationError,
          status: latestAudit.status === "failed" ? "error" : prev.status,
          error:
            latestAudit.status === "failed"
              ? latestAudit.renderError ??
                latestAudit.compilerError ??
                latestAudit.validationError
              : prev.error,
        }));
      }

      if (stateRecord.diagram) {
        setLoading(false);
        return;
      }
      await runGeneration(githubPat ?? undefined);
    } catch {
      setError("Something went wrong. Please try again later.");
      setLoading(false);
    }
  }, [repo, runGeneration, setState, username]);

  const handleRegenerate = useCallback(async () => {
    if (isExampleRepo(username, repo)) {
      return;
    }

    setLoading(true);
    setError("");

    const githubPat = localStorage.getItem("github_pat");

    try {
      await runGeneration(githubPat ?? undefined);
    } catch {
      setError("Something went wrong. Please try again later.");
      setLoading(false);
    }
  }, [repo, runGeneration, username]);

  useEffect(() => {
    void getDiagram();
  }, [getDiagram]);

  const { handleCopy, handleExportImage } = useDiagramExport(diagram);

  const handleApiKeySubmit = async (apiKey: string) => {
    setShowApiKeyDialog(false);
    setLoading(true);
    setError("");

    storeOpenAiKey(apiKey);

    const githubPat = localStorage.getItem("github_pat");
    try {
      await runGeneration(githubPat ?? undefined);
    } catch {
      setError("Failed to generate diagram with provided API key.");
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
      setError(`Diagram render failed: ${renderMessage}`);
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
