"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import type { DiagramStreamState } from "~/features/diagram/types";
import { GenerationAuditPanel } from "~/components/generation-audit-panel";
import { SponsorSlot } from "~/components/sponsor-slot";
import { loadDiagramRenderer } from "./load-diagram-renderer";
import { GenerationActivity } from "./generation-activity";
import { GenerationFeedback } from "./generation-feedback";
import { RepositorySource } from "./repository-source";
import { RepositoryToolbar } from "./repository-toolbar";
import { useDiagramPresentation } from "./use-diagram-presentation";
import styles from "./workspace.module.css";

const MermaidChart = dynamic(loadDiagramRenderer, { loading: () => null });

export function RepositoryWorkspace({
  repository,
  state,
  loading,
  lastGenerated,
  onRegenerate,
  onCancel,
  onRenderError,
  regenerateDisabled = false,
  recovery,
}: {
  repository: string;
  state: DiagramStreamState;
  loading: boolean;
  lastGenerated?: Date;
  onRegenerate: () => void;
  onCancel: () => void;
  onRenderError: (message: string) => void;
  regenerateDisabled?: boolean;
  recovery?: ReactNode;
}) {
  const {
    presented,
    result,
    layers,
    ready,
    active,
    failed,
    toolbarVisible,
    hasGeneration,
    workVisible,
    opening,
    announcement,
    renderFailed,
    candidateKey,
    complete,
    fail,
  } = useDiagramPresentation(state, loading, lastGenerated, onRenderError);
  const [zooming, setZooming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  const work = useRef<HTMLDivElement>(null);
  const regenerate = useRef<HTMLButtonElement>(null);
  const stop = useRef<HTMLButtonElement>(null);
  const focusRun = useRef(false);
  const focusResult = useRef(false);
  const historyId = useId();
  const historyVisible = toolbarVisible && showHistory;
  const getSvg = useCallback(
    () =>
      workspace.current?.querySelector<SVGSVGElement>(
        '[data-diagram-visible="true"] .mermaid svg',
      ) ?? null,
    [],
  );
  useEffect(() => {
    if (active && focusRun.current) {
      stop.current?.focus({ preventScroll: true });
      focusRun.current = false;
    }
    if (
      toolbarVisible &&
      (focusResult.current || work.current?.contains(document.activeElement))
    ) {
      regenerate.current?.focus({ preventScroll: true });
      focusResult.current = false;
    }
  }, [active, toolbarVisible]);
  const regenerateDiagram = () => {
    focusRun.current = document.activeElement === regenerate.current;
    setShowHistory(false);
    setEditing(false);
    onRegenerate();
  };
  const cancelGeneration = () => {
    focusResult.current = Boolean(
      presented && document.activeElement === stop.current,
    );
    onCancel();
  };
  return (
    <section
      ref={workspace}
      className={styles.workspace}
      aria-label="Repository diagram"
      data-repository-workspace
      data-ready={ready}
      data-has-diagram={Boolean(presented)}
    >
      <div
        className={`${styles.fold} ${styles.toolbarFold}`}
        data-open={toolbarVisible}
        aria-hidden={!toolbarVisible}
        inert={!toolbarVisible}
      >
        <div className={styles.foldClip}>
          <RepositoryToolbar
            repository={repository}
            diagram={result.diagram}
            historyId={historyId}
            historyVisible={historyVisible}
            toggleHistory={() => setShowHistory((value) => !value)}
            zooming={zooming}
            toggleZoom={() => setZooming((value) => !value)}
            onRegenerate={regenerateDiagram}
            regenerateDisabled={regenerateDisabled}
            regenerateRef={regenerate}
            getSvg={getSvg}
            editing={editing}
            toggleEditing={() => setEditing((value) => !value)}
            pending={!presented}
            lastGenerated={result.lastGenerated}
            cost={result.state.costSummary}
          />
        </div>
      </div>
      <div
        ref={work}
        className={styles.fold}
        data-open={workVisible}
        aria-hidden={!workVisible}
        inert={!workVisible}
      >
        <div className={styles.foldClip}>
          {hasGeneration && (
            <div className={styles.work}>
              {(!toolbarVisible || ready) && (
                <RepositorySource
                  repository={repository}
                  active={active}
                  stopRef={stop}
                  onCancel={cancelGeneration}
                  onRetry={regenerateDiagram}
                />
              )}
              <GenerationFeedback
                key={state.startedAt ?? "stored"}
                state={state}
                active={active}
                renderFailed={renderFailed}
                hasPrevious={Boolean(presented && !ready)}
                recovery={recovery}
              />
            </div>
          )}
        </div>
      </div>
      <div
        id={historyId}
        className={styles.fold}
        data-open={historyVisible}
        aria-hidden={!historyVisible}
        inert={!historyVisible}
      >
        <div className={styles.foldClip}>
          <div className={styles.resultActivity}>
            {presented && <GenerationActivity state={presented.state} />}
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <div
        className={styles.diagram}
        data-zooming={zooming}
        aria-busy={(active || opening) && !presented}
      >
        {opening && (
          <div className={styles.savedLoading} aria-hidden="true">
            <span>Loading diagram…</span>
          </div>
        )}
        {layers.map((layer) => {
          const visible = presented?.key === layer.key;
          const candidate = candidateKey === layer.key;
          return (
            <div
              key={layer.key}
              className={styles.graphLayer}
              data-diagram-visible={visible}
              aria-hidden={!visible}
              inert={!visible}
            >
              <MermaidChart
                chart={layer.diagram}
                zoomingEnabled={zooming}
                containerClassName={styles.chart}
                onRenderComplete={candidate ? complete : undefined}
                onRenderError={candidate ? fail : undefined}
              />
            </div>
          );
        })}
      </div>
      {failed && state.latestSessionAudit && (
        <details className={styles.diagnostics}>
          <summary>Technical details</summary>
          <GenerationAuditPanel audit={state.latestSessionAudit} />
        </details>
      )}
      {ready && <SponsorSlot surface="diagram" className="mt-10 mb-6" />}
    </section>
  );
}
