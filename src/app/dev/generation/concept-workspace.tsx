"use client";

import { useCallback, useState } from "react";
import { Check, CircleAlert, GitBranch, Pause } from "lucide-react";
import type { DiagramStreamState } from "~/features/diagram/types";
import type { Approach } from "./use-preview";
import {
  ActivityDetails,
  ActivityMark,
  RepositoryControl,
  WorkThread,
} from "./concept-parts";
import styles from "./concept.module.css";
import { conceptState } from "./concept-state";

import { ConceptDiagram } from "./concept-diagram";

export function ConceptWorkspace({
  runId = 0,
  approach,
  stream,
  seconds,
  started,
  paused,
  cancelled,
  stalled,
  previousDiagram,
  onStart,
  onCancel,
  onRegenerate,
}: {
  runId?: number;
  approach: Approach;
  stream: DiagramStreamState;
  seconds: number;
  started: boolean;
  paused: boolean;
  cancelled: boolean;
  stalled: boolean;
  previousDiagram?: string;
  onStart: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
}) {
  const [renderedChart, setRenderedChart] = useState<string>();
  const [renderFailure, setRenderFailure] = useState<{
    key: string;
    message: string;
  }>();
  const {
    diagram,
    renderKey,
    renderFailed,
    ready,
    failed,
    active,
    quiet,
    hasPrevious,
    title,
    description,
  } = conceptState({
    stream,
    runId,
    previousDiagram,
    renderedChart,
    renderFailureKey: renderFailure?.key,
    started,
    cancelled,
    stalled,
    seconds,
  });
  const handleComplete = useCallback(
    () => setRenderedChart(renderKey),
    [renderKey],
  );
  const handleError = useCallback(
    (message: string) => {
      setRenderFailure({ key: renderKey, message });
    },
    [renderKey],
  );
  const start = () => {
    setRenderFailure(undefined);
    onStart();
  };

  return (
    <section
      className={styles.concept}
      data-approach={approach}
      data-active={active}
      data-started={started}
      data-paused={paused}
      data-has-diagram={Boolean(diagram)}
      data-ready={ready}
      data-quiet={quiet}
      aria-label={`${approach} generation approach`}
    >
      <div className={styles.stage}>
        <div className={styles.source}>
          <RepositoryControl
            active={active}
            ready={ready}
            failed={failed}
            onStart={start}
            onCancel={onCancel}
            onRegenerate={onRegenerate}
          />
        </div>
        <GenerationFeedback
          failed={failed}
          cancelled={cancelled}
          ready={ready}
          started={started}
          quiet={quiet}
          title={title}
          seconds={seconds}
          description={description}
          hasPrevious={hasPrevious}
          approach={approach}
          stream={stream}
          active={active}
        />
        <ConceptDiagram
          diagram={diagram}
          previousDiagram={previousDiagram}
          runId={runId}
          ready={ready}
          renderFailed={renderFailed}
          showNew={stream.status === "complete" && !cancelled}
          onComplete={handleComplete}
          onError={handleError}
        />
        {approach === "canvas" && !diagram && (
          <div className={styles.canvasLabel} aria-hidden="true">
            gitdiagram <span>/ workspace</span>
          </div>
        )}
      </div>
    </section>
  );
}

function GenerationFeedback({
  failed,
  cancelled,
  ready,
  started,
  quiet,
  title,
  seconds,
  description,
  hasPrevious,
  approach,
  stream,
  active,
}: {
  failed: boolean;
  cancelled: boolean;
  ready: boolean;
  started: boolean;
  quiet: boolean;
  title: string;
  seconds: number;
  description: string;
  hasPrevious: boolean;
  approach: Approach;
  stream: DiagramStreamState;
  active: boolean;
}) {
  return (
    <div className={styles.feedback}>
      <div className={styles.statusLine}>
        {failed ? (
          cancelled ? (
            <Pause size={17} aria-hidden="true" />
          ) : (
            <CircleAlert size={17} aria-hidden="true" />
          )
        ) : ready ? (
          <Check size={17} aria-hidden="true" />
        ) : started ? (
          <ActivityMark active={!quiet} />
        ) : (
          <GitBranch size={19} aria-hidden="true" />
        )}
        <h2
          key={title}
          className={styles.statusTitle}
          role={failed && !cancelled ? "alert" : undefined}
          aria-live="polite"
          aria-atomic="true"
        >
          {title}
        </h2>
        {started && !failed && (
          <span
            className={styles.elapsed}
            aria-label={`${Math.floor(seconds)} seconds elapsed`}
          >
            {Math.floor(seconds / 60)}:
            {String(Math.floor(seconds % 60)).padStart(2, "0")}
          </span>
        )}
      </div>
      <p className={styles.description}>{description}</p>
      {hasPrevious && started && (
        <span className={styles.previousLabel}>
          Previous diagram stays available
        </span>
      )}
      {started && approach !== "thread" && (
        <ActivityDetails
          stream={stream}
          seconds={seconds}
          active={active}
          ready={ready}
        />
      )}
      {started && approach === "thread" && (
        <WorkThread
          stream={stream}
          seconds={seconds}
          active={active}
          ready={ready}
        />
      )}
    </div>
  );
}
