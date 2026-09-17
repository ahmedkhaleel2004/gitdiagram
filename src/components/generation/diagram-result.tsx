"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { Check } from "lucide-react";
import type { DiagramGraph } from "~/features/diagram/graph";
import { ArchitectureNotes } from "./architecture-notes";
import { GenerationWorkspace } from "./generation-workspace";
import styles from "./generation.module.css";

import { loadDiagramRenderer } from "./load-diagram-renderer";
const MermaidChart = dynamic(loadDiagramRenderer, { loading: () => null });

export function DiagramResult({
  diagram,
  repository,
  explanation,
  graph,
  startedAt,
  zoomingEnabled,
  onRenderError,
  onRenderComplete,
}: {
  diagram: string;
  repository: string;
  explanation?: string;
  graph?: DiagramGraph;
  startedAt?: number;
  zoomingEnabled?: boolean;
  onRenderError?: (message: string) => void;
  onRenderComplete?: () => void;
}) {
  const [renderedChart, setRenderedChart] = useState<string | null>(null);
  const [failedChart, setFailedChart] = useState<string | null>(null);
  const ready = renderedChart === diagram;
  const waiting = !ready && failedChart !== diagram;
  const handleComplete = useCallback(() => {
    setRenderedChart(diagram);
    onRenderComplete?.();
  }, [diagram, onRenderComplete]);
  const handleError = useCallback(
    (message: string) => {
      setFailedChart(diagram);
      onRenderError?.(message);
    },
    [diagram, onRenderError],
  );

  return (
    <div className={styles.result}>
      {waiting && (
        <GenerationWorkspace
          status="diagram_compiling"
          repository={repository}
          explanation={explanation}
          graph={graph}
          startedAt={startedAt}
        />
      )}
      <div
        className={styles.resultContent}
        data-waiting={waiting}
        aria-hidden={waiting}
        inert={waiting}
      >
        {ready && (
          <div className={styles.resultBar} role="status">
            <span>
              <Check size={15} aria-hidden="true" /> Diagram ready
              {graph && (
                <small>
                  {graph.nodes.length} components · {graph.edges.length}{" "}
                  connections
                </small>
              )}
            </span>
          </div>
        )}
        {explanation && (
          <ArchitectureNotes
            text={explanation}
            streaming={false}
            initiallyExpanded={false}
          />
        )}
        <MermaidChart
          chart={diagram}
          zoomingEnabled={zoomingEnabled}
          onRenderError={handleError}
          onRenderComplete={handleComplete}
        />
      </div>
    </div>
  );
}
