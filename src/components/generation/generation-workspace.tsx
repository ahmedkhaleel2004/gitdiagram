"use client";

import type { ReactNode } from "react";
import { CircleAlert, Pause } from "lucide-react";
import type { DiagramStreamStatus } from "~/features/diagram/types";
import type { DiagramGraph } from "~/features/diagram/graph";
import { ArchitectureNotes } from "./architecture-notes";
import { GenerationSteps, useGenerationClock } from "./generation-status";
import { generationCopy, generationStep } from "./progress";
import styles from "./generation.module.css";

interface GenerationWorkspaceProps {
  status: DiagramStreamStatus;
  repository?: string;
  explanation?: string;
  graph?: DiagramGraph;
  onCancel?: () => void;
  error?: string;
  cancelled?: boolean;
  recovery?: ReactNode;
  startedAt?: number;
  lastActivityAt?: number;
  sourceFileCount?: number;
  elapsedSeconds?: number;
  paused?: boolean;
}

export function GenerationWorkspace({
  status,
  repository,
  explanation,
  graph,
  onCancel,
  error,
  cancelled = false,
  recovery,
  startedAt,
  lastActivityAt,
  sourceFileCount,
  elapsedSeconds,
  paused = false,
}: GenerationWorkspaceProps) {
  const failed = status === "error";
  const step = generationStep(status);
  const { now, seconds } = useGenerationClock({
    running: !failed,
    paused,
    startedAt,
    value: elapsedSeconds,
  });
  const activityClock =
    elapsedSeconds !== undefined && startedAt !== undefined
      ? startedAt + seconds * 1000
      : now;
  const rendering = status === "diagram_compiling" || status === "complete";
  const quiet =
    !rendering &&
    (lastActivityAt !== undefined
      ? activityClock - lastActivityAt > 25_000
      : seconds > 25);
  const connecting = lastActivityAt === undefined && !rendering;
  const copy = generationCopy(status);
  const title = failed
    ? cancelled
      ? "Generation stopped"
      : "Let’s try that again"
    : copy.title;
  const connection = quiet
    ? "Waiting for updates"
    : connecting
      ? "Connecting"
      : seconds >= 20 && !rendering
        ? "Still working"
        : undefined;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <section
      className={styles.workspace}
      aria-label="Diagram generation"
      data-state={failed ? "error" : quiet ? "quiet" : "running"}
      data-stage={step}
      data-paused={paused}
    >
      <div className={styles.atmosphere} aria-hidden="true">
        <div className={styles.halo} />
        {failed ? (
          <div className={styles.errorSymbol}>
            {cancelled ? <Pause size={28} /> : <CircleAlert size={28} />}
          </div>
        ) : (
          <div className={styles.bloom}>
            <i className={styles.petalOne} />
            <i className={styles.petalTwo} />
            <i className={styles.petalThree} />
            <i className={styles.glint} />
          </div>
        )}
      </div>
      <div className={styles.message}>
        <div
          className={styles.heading}
          role={failed ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          <h2 key={title}>{title}</h2>
          {failed ? <p className={styles.errorDetail}>{error}</p> : null}
          {!failed && <span className="sr-only">{copy.description}</span>}
        </div>
        {repository && <p className={styles.repository}>{repository}</p>}
        {!failed ? (
          <div className={styles.activity}>
            <span className={styles.connection} aria-live="polite">
              {connection}
            </span>
            <span
              className={styles.elapsed}
              aria-label={`${seconds} seconds elapsed`}
            >
              {duration}
            </span>
          </div>
        ) : null}
      </div>
      {!failed && (
        <div className="sr-only">
          {graph ? (
            <p>
              {graph.nodes.length} components · {graph.edges.length} connections
            </p>
          ) : sourceFileCount !== undefined ? (
            <p>{sourceFileCount} source files · README and file tree</p>
          ) : null}
          <GenerationSteps step={step} />
        </div>
      )}
      {!failed && onCancel && (
        <button
          className={styles.stopButton}
          type="button"
          aria-label="Stop generation"
          onClick={onCancel}
        >
          Cancel
        </button>
      )}
      {failed && recovery && <div className={styles.recovery}>{recovery}</div>}
      {failed && explanation && (
        <ArchitectureNotes text={explanation} streaming={false} />
      )}
    </section>
  );
}
