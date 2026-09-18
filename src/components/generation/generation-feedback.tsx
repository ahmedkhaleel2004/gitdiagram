"use client";

import type { ReactNode } from "react";
import { CircleAlert, Pause } from "lucide-react";
import type { DiagramStreamState } from "~/features/diagram/types";
import { useGenerationClock } from "./generation-status";
import { ExpandedActivity } from "./generation-activity";
import { feedbackState } from "./feedback-state";
import styles from "./workspace.module.css";

export function ActivityMark({ active = true }: { active?: boolean }) {
  return (
    <span
      className={styles.activityMark}
      data-active={active}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((dot) => (
        <i key={dot} />
      ))}
    </span>
  );
}

export function GenerationFeedback({
  state,
  active,
  renderFailed = false,
  hasPrevious = false,
  recovery,
}: {
  state: DiagramStreamState;
  active: boolean;
  renderFailed?: boolean;
  hasPrevious?: boolean;
  recovery?: ReactNode;
}) {
  const { seconds, now } = useGenerationClock({
    running: active,
    paused: false,
    startedAt: state.startedAt,
  });
  const { failed, cancelled, quiet, title, description } = feedbackState(
    state,
    active,
    renderFailed,
    seconds,
    now,
  );
  return (
    <div className={styles.feedback}>
      <div className={styles.statusLine}>
        {failed ? (
          cancelled ? (
            <Pause size={17} aria-hidden="true" />
          ) : (
            <CircleAlert size={17} aria-hidden="true" />
          )
        ) : (
          <ActivityMark active={active && !quiet} />
        )}
        <h2
          className={styles.statusTitle}
          role={failed && !cancelled ? "alert" : undefined}
          aria-live="polite"
          aria-atomic="true"
        >
          {title}
        </h2>
        {!failed && (
          <span
            className={styles.elapsed}
            aria-label={`${seconds} seconds elapsed`}
          >
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      {description && <p className={styles.description}>{description}</p>}
      {hasPrevious && (
        <p className={styles.previousLabel}>Showing previous diagram</p>
      )}
      {failed && recovery && <div className={styles.recovery}>{recovery}</div>}
      <ExpandedActivity key={state.startedAt ?? "stored"} state={state} />
    </div>
  );
}
