import { useState, useEffect, useCallback } from "react";

import {
  cacheDiagramAndExplanation,
  getCachedDiagram,
} from "~/app/_actions/cache";
import { getLastGeneratedDate } from "~/app/_actions/repo";
import { getGenerationCost } from "~/features/diagram/api";
import { type DiagramStreamState } from "~/features/diagram/types";
import { useDiagramStream } from "~/hooks/diagram/useDiagramStream";
import { useDiagramExport } from "~/hooks/diagram/useDiagramExport";
import { isExampleRepo } from "~/lib/exampleRepos";

export function useDiagram(username: string, repo: string) {
  const [diagram, setDiagram] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastGenerated, setLastGenerated] = useState<Date | undefined>();
  const [cost, setCost] = useState<string>("");
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [hasUsedFreeGeneration, setHasUsedFreeGeneration] = useState<boolean>(
    () => {
      if (typeof window === "undefined") return false;
      return localStorage.getItem("has_used_free_generation") === "true";
    },
  );

  const onStreamComplete = useCallback(
    async ({
      diagram: nextDiagram,
      explanation,
    }: {
      diagram: string;
      explanation: string;
    }) => {
      const hasApiKey = !!localStorage.getItem("openai_key");
      await cacheDiagramAndExplanation(
        username,
        repo,
        nextDiagram,
        explanation || "No explanation provided",
        hasApiKey,
      );

      setDiagram(nextDiagram);
      const date = await getLastGeneratedDate(username, repo);
      setLastGenerated(date ?? undefined);
      if (!hasUsedFreeGeneration) {
        localStorage.setItem("has_used_free_generation", "true");
        setHasUsedFreeGeneration(true);
      }
      setLoading(false);
    },
    [hasUsedFreeGeneration, repo, username],
  );

  const onStreamError = useCallback((message: string) => {
    setError(message);
    setLoading(false);
  }, []);

  const { state, runGeneration } = useDiagramStream({
    username,
    repo,
    onComplete: onStreamComplete,
    onError: onStreamError,
  });

  useEffect(() => {
    if (state.status === "error") {
      setLoading(false);
    }
  }, [state.status]);

  const getDiagram = useCallback(async () => {
    setLoading(true);
    setError("");
    setCost("");

    try {
      const cached = await getCachedDiagram(username, repo);
      const githubPat = localStorage.getItem("github_pat");

      if (cached) {
        setDiagram(cached);
        const date = await getLastGeneratedDate(username, repo);
        setLastGenerated(date ?? undefined);
        setLoading(false);
        return;
      }

      const costEstimate = await getGenerationCost(
        username,
        repo,
        githubPat ?? undefined,
      );

      if (costEstimate.error) {
        setError(costEstimate.error);
        setLoading(false);
        return;
      }

      setCost(costEstimate.cost ?? "");
      await runGeneration(githubPat ?? undefined);
    } catch {
      setError("Something went wrong. Please try again later.");
      setLoading(false);
    }
  }, [repo, runGeneration, username]);

  const handleRegenerate = useCallback(async () => {
    if (isExampleRepo(username, repo)) {
      return;
    }

    setLoading(true);
    setError("");
    setCost("");

    const githubPat = localStorage.getItem("github_pat");

    try {
      const costEstimate = await getGenerationCost(
        username,
        repo,
        githubPat ?? undefined,
      );

      if (costEstimate.error) {
        setError(costEstimate.error);
        setLoading(false);
        return;
      }

      setCost(costEstimate.cost ?? "");
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

    localStorage.setItem("openai_key", apiKey);

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

  return {
    diagram,
    error,
    loading,
    lastGenerated,
    cost,
    handleCopy,
    showApiKeyDialog,
    handleApiKeySubmit,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    handleRegenerate,
    state: state as DiagramStreamState,
  };
}
