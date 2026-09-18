"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { loadDiagramRenderer } from "~/components/generation/load-diagram-renderer";
import { themedDemoDiagram } from "./fixture";
import styles from "./concept.module.css";

const MermaidChart = dynamic(loadDiagramRenderer, { loading: () => null });

export function ConceptDiagram({
  zoomingEnabled,
  diagram,
  previousDiagram,
  runId,
  ready,
  renderFailed,
  showNew,
  onComplete,
  onError,
}: {
  zoomingEnabled: boolean;
  diagram?: string;
  previousDiagram?: string;
  runId: number;
  ready: boolean;
  renderFailed: boolean;
  showNew: boolean;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  if (!diagram) return null;
  return (
    <div
      className={styles.diagram}
      data-zooming={zoomingEnabled}
      data-visible={Boolean(previousDiagram) || ready}
      data-previous={Boolean(previousDiagram) && !ready}
      aria-busy={!previousDiagram && !ready && !renderFailed}
    >
      {previousDiagram && (
        <div
          className={styles.graphLayer}
          data-hidden={ready}
          aria-hidden={ready}
          inert={ready}
        >
          <MermaidChart
            chart={themedDemoDiagram(previousDiagram, resolvedTheme === "dark")}
            zoomingEnabled={zoomingEnabled}
            containerClassName={styles.chart}
          />
        </div>
      )}
      {showNew && (
        <div
          key={runId}
          className={styles.graphLayer}
          data-hidden={!ready}
          aria-hidden={!ready}
          inert={!ready}
        >
          <MermaidChart
            chart={themedDemoDiagram(diagram, resolvedTheme === "dark")}
            zoomingEnabled={zoomingEnabled}
            containerClassName={styles.chart}
            onRenderComplete={onComplete}
            onRenderError={onError}
          />
        </div>
      )}
    </div>
  );
}
