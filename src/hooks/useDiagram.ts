import { useState, useEffect, useCallback, useRef } from "react";

import {
  cacheDiagramAndExplanation,
  getCachedDiagram,
} from "~/app/_actions/cache";
import { getLastGeneratedDate } from "~/app/_actions/repo";
import {
  getGenerationCost,
  repairGeneratedDiagram,
} from "~/features/diagram/api";
import { type DiagramStreamState } from "~/features/diagram/types";
import { useDiagramStream } from "~/hooks/diagram/useDiagramStream";
import { useDiagramExport } from "~/hooks/diagram/useDiagramExport";
import { isExampleRepo } from "~/lib/exampleRepos";
import {
  getStoredOpenAiKey,
  storeOpenAiKey,
} from "~/lib/openai-key";

export function useDiagram(username: string, repo: string) {
  const [diagram, setDiagram] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastGenerated, setLastGenerated] = useState<Date | undefined>();
  const [cost, setCost] = useState<string>("");
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const hasUsedFreeGenerationRef = useRef<boolean>(
    typeof window !== "undefined" &&
      localStorage.getItem("has_used_free_generation") === "true",
  );
  const lastRepairAttemptRef = useRef<string | null>(null);

  const applyCompletedDiagram = useCallback(
    async ({
      diagram: nextDiagram,
      explanation,
    }: {
      diagram: string;
      explanation: string;
    }) => {
      const hasApiKey = !!getStoredOpenAiKey();
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
      if (!hasUsedFreeGenerationRef.current) {
        localStorage.setItem("has_used_free_generation", "true");
        hasUsedFreeGenerationRef.current = true;
      }
      lastRepairAttemptRef.current = null;
      setLoading(false);
    },
    [repo, username],
  );

  const onStreamComplete = useCallback(
    async (result: { diagram: string; explanation: string }) => {
      await applyCompletedDiagram(result);
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
      const apiKey = getStoredOpenAiKey();

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
        apiKey ?? undefined,
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
    const apiKey = getStoredOpenAiKey();

    try {
      const costEstimate = await getGenerationCost(
        username,
        repo,
        githubPat ?? undefined,
        apiKey ?? undefined,
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
    async (parserError: string) => {
      if (!diagram) {
        setError(`Mermaid render failed: ${parserError}`);
        setLoading(false);
        return;
      }

      const repairKey = `${diagram}::${parserError}`;
      if (lastRepairAttemptRef.current === repairKey) {
        setError(`Mermaid render failed after auto-repair: ${parserError}`);
        setLoading(false);
        return;
      }

      lastRepairAttemptRef.current = repairKey;
      setLoading(true);
      setError("");
      setState({
        status: "diagram_fixing",
        message: "Browser render failed. Starting Mermaid auto-fix loop...",
        parserError,
        explanation: state.explanation,
        mapping: state.mapping,
        diagram,
      });

      try {
        const repairResult = await repairGeneratedDiagram({
          username,
          repo,
          diagram,
          explanation: state.explanation ?? "",
          mapping: state.mapping ?? "",
          parserError,
          apiKey: getStoredOpenAiKey() ?? undefined,
        });

        if (!repairResult.ok || !repairResult.diagram) {
          const message =
            repairResult.error ?? "Failed to repair Mermaid diagram.";
          setState({
            status: "error",
            error: message,
            parserError: repairResult.parser_error ?? parserError,
          });
          setError(message);
          setLoading(false);
          return;
        }

        setState({
          status: "complete",
          diagram: repairResult.diagram,
          explanation: state.explanation,
          mapping: state.mapping,
        });
        await applyCompletedDiagram({
          diagram: repairResult.diagram,
          explanation: state.explanation ?? "No explanation provided",
        });
      } catch {
        setError("Failed to repair Mermaid diagram.");
        setLoading(false);
      }
    },
    [
      applyCompletedDiagram,
      diagram,
      repo,
      setState,
      state.explanation,
      state.mapping,
      username,
    ],
  );

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
    handleDiagramRenderError,
    state: state as DiagramStreamState,
  };
}
