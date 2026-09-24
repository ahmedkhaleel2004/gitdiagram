"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type {
  VideoGenerationProgress,
  VideoGenerationStage,
} from "~/features/explainer/types";
import styles from "./explainer-video.module.css";

type RowState = "pending" | "running" | "done";

const ORDER: VideoGenerationStage[] = [
  "reading",
  "planning",
  "designing",
  "saving",
];

/** Status mark for one row: a dot, a spinning ring (with a count), or a check. */
function RowMark({
  state,
  count,
  total,
}: {
  state: RowState;
  count?: number;
  total?: number;
}) {
  if (state === "done")
    return (
      <span className={styles.rowDone} aria-hidden="true">
        <Check size={12} strokeWidth={3.2} />
      </span>
    );
  if (state === "pending")
    return <span className={styles.rowPending} aria-hidden="true" />;
  const fraction = total ? Math.min(1, (count ?? 0) / total) : 0.25;
  const circumference = 2 * Math.PI * 9;
  return (
    <span className={styles.rowRunning} aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="9" className={styles.ringTrack} />
        <circle
          cx="11"
          cy="11"
          r="9"
          className={styles.ringValue}
          strokeDasharray={`${Math.max(0.12, fraction) * circumference} ${circumference}`}
        />
      </svg>
    </span>
  );
}

function Row({
  state,
  label,
  metric,
  count,
  total,
  index,
}: {
  state: RowState;
  label: string;
  metric?: string;
  count?: number;
  total?: number;
  index: number;
}) {
  return (
    <li
      className={styles.row}
      data-state={state}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <RowMark state={state} count={count} total={total} />
      <span className={styles.rowLabel}>{label}</span>
      {metric && <span className={styles.rowMetric}>{metric}</span>}
    </li>
  );
}

/** Live task rows for a generation, from the progress the server reports. */
export function GenerationRows({
  stage,
  progress,
}: {
  stage: VideoGenerationStage;
  progress: VideoGenerationProgress;
}) {
  const at = ORDER.indexOf(stage);
  const state = (step: VideoGenerationStage, done = false): RowState => {
    const index = ORDER.indexOf(step);
    if (done || index < at) return "done";
    return index === at ? "running" : "pending";
  };
  const scenes = progress.scenes;
  const designed = progress.designed ?? 0;
  const voiced = progress.voiced ?? 0;
  const designDone = Boolean(scenes && designed >= scenes);
  const voiceDone = Boolean(scenes && voiced >= scenes);
  return (
    <ol className={styles.rows} aria-label="Progress">
      <Row
        index={0}
        state={state("reading")}
        label="Read the code"
        metric={
          progress.sourceFiles !== undefined
            ? `${progress.sourceFiles} files`
            : undefined
        }
      />
      <Row
        index={1}
        state={state("planning")}
        label="Write the script"
        metric={
          scenes ? `${scenes} scenes · ${progress.words} words` : undefined
        }
      />
      <Row
        index={2}
        state={at < 2 ? "pending" : at > 2 || designDone ? "done" : "running"}
        label="Design the scenes"
        metric={scenes ? `${designed}/${scenes}` : undefined}
        count={designed}
        total={scenes}
      />
      <Row
        index={3}
        state={at < 2 ? "pending" : at > 2 || voiceDone ? "done" : "running"}
        label="Record the narration"
        metric={scenes ? `${voiced}/${scenes}` : undefined}
        count={voiced}
        total={scenes}
      />
      <Row index={4} state={state("saving")} label="Save the video" />
    </ol>
  );
}

/**
 * The script, typed out as it would be read aloud, once the director has
 * written it: a preview of what the video will say while it is being made.
 */
export function ScriptPreview({ lines }: { lines: string[] }) {
  const text = lines.join(" ");
  const [reduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(
      () => setTyped((value) => Math.min(text.length, value + 3)),
      28,
    );
    return () => window.clearInterval(timer);
  }, [text, reduced]);
  const shown = reduced ? text.length : typed;
  return (
    <figure className={styles.script}>
      <figcaption>What you&apos;ll hear</figcaption>
      <p aria-label={text}>
        <span aria-hidden="true">{text.slice(0, shown)}</span>
        {shown < text.length && (
          <span className={styles.caret} aria-hidden="true" />
        )}
      </p>
    </figure>
  );
}

/** One live job, like an MP4 render: a filling ring, a shimmering label and a percentage. */
export function JobRow({
  label,
  fraction,
}: {
  label: string;
  fraction: number;
}) {
  return (
    <div className={`${styles.row} ${styles.jobRow}`} data-state="running">
      <RowMark state="running" count={fraction} total={1} />
      <span className={`${styles.rowLabel} ${styles.shimmer}`}>{label}</span>
      <span className={styles.rowMetric}>{Math.round(fraction * 100)}%</span>
    </div>
  );
}
