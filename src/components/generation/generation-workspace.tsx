"use client";

import type { CSSProperties, ReactNode } from "react";
import { CircleAlert, GitBranch, Pause, Square } from "lucide-react";
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
  const quiet =
    lastActivityAt !== undefined && activityClock - lastActivityAt > 25_000;
  const connecting =
    lastActivityAt === undefined &&
    status !== "diagram_compiling" &&
    status !== "complete";
  const copy = generationCopy(status);
  const title = failed
    ? cancelled
      ? "Generation stopped"
      : "Couldn’t complete the diagram"
    : copy.title;
  const streaming = step === 1 && !failed;
  const detail = failed
    ? error
    : quiet
      ? "No updates have arrived recently. You can wait a little longer or stop and retry."
      : copy.description;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <section
      className={styles.workspace}
      aria-label="Diagram generation"
      data-state={failed ? "error" : quiet ? "quiet" : "running"}
      data-paused={paused}
    >
      {repository && (
        <div className={styles.repository}>
          <GitBranch size={13} aria-hidden="true" />
          <span>{repository}</span>
        </div>
      )}
      <div className={styles.statusRow}>
        <div className={styles.indicator} aria-hidden="true">
          {failed ? (
            cancelled ? (
              <Pause size={22} />
            ) : (
              <CircleAlert size={22} />
            )
          ) : (
            <span className={styles.glyph}>
              {Array.from({ length: 9 }, (_, index) => (
                <i key={index} style={{ "--dot": index } as CSSProperties} />
              ))}
            </span>
          )}
        </div>
        <div
          className={styles.heading}
          role={failed ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          <h2 className={!failed && !quiet ? styles.shimmer : undefined}>
            {title}
          </h2>
          <p>{detail}</p>
        </div>
        {!failed && (
          <div className={styles.controls}>
            <span
              className={styles.elapsed}
              aria-label={`${seconds} seconds elapsed`}
            >
              {duration}
            </span>
            {onCancel && (
              <button
                className={styles.stopButton}
                type="button"
                aria-label="Stop generation"
                title="Stop generation"
                onClick={onCancel}
              >
                <Square size={11} fill="currentColor" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
      {!failed && (
        <div className={styles.context}>
          {graph
            ? `${graph.nodes.length} components · ${graph.edges.length} connections`
            : sourceFileCount !== undefined
              ? `${sourceFileCount ? `${sourceFileCount} source files · ` : ""}README and file tree`
              : status === "idle"
                ? "Your diagram will open here."
                : "Preparing repository context"}
        </div>
      )}
      {!failed && <GenerationSteps step={step} />}
      {failed && recovery && <div className={styles.recovery}>{recovery}</div>}
      {!failed && (
        <div className={styles.connectionRow}>
          <span
            className={styles.connection}
            data-connected={!connecting && !quiet}
            data-quiet={quiet}
          >
            <i aria-hidden="true" />
            {quiet
              ? "Waiting for updates"
              : connecting
                ? "Connecting"
                : status === "diagram_compiling" || status === "complete"
                  ? "Rendering diagram"
                  : "Connected"}
          </span>
          <span className={styles.waiting}>
            {quiet
              ? ""
              : streaming && !explanation
                ? seconds >= 20
                  ? "Analysis can take about a minute"
                  : "The overview will appear when it’s ready"
                : streaming
                  ? "Receiving architecture overview"
                  : step === 2
                    ? "Preparing the interactive view"
                    : ""}
          </span>
        </div>
      )}
      {explanation && (
        <ArchitectureNotes
          text={explanation}
          streaming={streaming}
          initiallyExpanded={false}
        />
      )}
    </section>
  );
}
