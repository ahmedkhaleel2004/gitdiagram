"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { GenerationAuditPanel } from "~/components/generation-audit-panel";
import Loading from "~/components/loading";
import MermaidChart from "~/components/mermaid-diagram";
import { Button } from "~/components/ui/button";
import { useDiagramExport } from "~/hooks/diagram/useDiagramExport";
import { useDiagramStream } from "~/hooks/diagram/useDiagramStream";

function getLocalRepoName(localPath: string): string {
  return localPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "repository";
}

export default function LocalPageClient({ localPath }: { localPath: string }) {
  const [loading, setLoading] = useState(true);
  const [zoomingEnabled, setZoomingEnabled] = useState(false);
  const [diagramRendered, setDiagramRendered] = useState(false);
  const repo = useMemo(() => getLocalRepoName(localPath), [localPath]);

  const onComplete = useCallback(async () => {
    setLoading(false);
  }, []);
  const onError = useCallback(() => {
    setLoading(false);
  }, []);

  const { state, runGeneration, setState } = useDiagramStream({
    username: "local",
    repo,
    localPath,
    onComplete,
    onError,
  });

  const diagram = state.diagram ?? "";
  const { handleCopy, handleExportImage } = useDiagramExport(diagram);

  const regenerate = useCallback(async () => {
    setLoading(true);
    setDiagramRendered(false);
    setState({
      status: "started",
      message: "Starting generation process...",
    });
    try {
      await runGeneration();
    } catch {
      setLoading(false);
    }
  }, [runGeneration, setState]);

  useEffect(() => {
    void regenerate();
  }, [regenerate]);

  useEffect(() => {
    setDiagramRendered(false);
  }, [diagram, zoomingEnabled]);

  return (
    <main className="flex flex-col items-center gap-8 p-4 pt-8">
      <section className="neo-panel w-full max-w-5xl !bg-[hsl(var(--neo-panel))] p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Local repository diagram</h1>
            <p className="truncate text-sm text-[hsl(var(--neo-soft-text))]">
              {localPath}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={regenerate}>
              Regenerate
            </Button>
            {diagram && (
              <>
                <Button type="button" variant="outline" onClick={handleCopy}>
                  Copy Mermaid
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleExportImage}
                >
                  Export PNG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setZoomingEnabled((value) => !value)}
                >
                  {zoomingEnabled ? "Disable Zoom" : "Enable Zoom"}
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {loading ? (
        <Loading
          costSummary={state.costSummary}
          status={state.status}
          message={state.message}
          explanation={state.explanation}
          graph={state.graph}
          graphAttempts={state.graphAttempts}
          validationError={state.validationError}
          diagram={state.diagram}
        />
      ) : state.error ? (
        <div className="w-full max-w-5xl text-center">
          <GenerationAuditPanel
            audit={state.latestSessionAudit}
            error={state.error}
          />
        </div>
      ) : diagram ? (
        <div className="flex w-full justify-center px-4">
          <MermaidChart
            chart={diagram}
            zoomingEnabled={zoomingEnabled}
            onRenderError={(message) =>
              setState((prev) => ({
                ...prev,
                status: "error",
                error: `Diagram render failed: ${message}`,
              }))
            }
            onRenderComplete={() => setDiagramRendered(true)}
          />
        </div>
      ) : null}

      {diagramRendered && (
        <p className="text-sm text-[hsl(var(--neo-soft-text))]">
          Diagram generated from local files.
        </p>
      )}
    </main>
  );
}
