"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  FileCode2,
  GitBranch,
  Layers2,
  Square,
  ArrowUpRight,
} from "lucide-react";
import { ArchitectureNotes } from "~/components/generation/architecture-notes";
import type { DiagramStreamState } from "~/features/diagram/types";
import { generationStep } from "~/components/generation/progress";
import styles from "./concept.module.css";

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

export function RepositoryControl({
  active,
  ready,
  failed,
  onStart,
  onCancel,
  onRegenerate,
}: {
  active: boolean;
  ready: boolean;
  failed: boolean;
  onStart: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className={styles.repositoryControl}>
      <GitBranch size={18} aria-hidden="true" />
      <div className={styles.repositoryName}>
        <span>ahmedkhaleel2004 / </span>
        <strong>gitdiagram</strong>
      </div>
      {active ? (
        <button
          className={styles.cancel}
          type="button"
          onClick={onCancel}
          aria-label="Stop generation"
        >
          <Square size={12} fill="currentColor" aria-hidden="true" />
        </button>
      ) : (
        <button
          className={styles.generate}
          type="button"
          onClick={ready ? onRegenerate : onStart}
        >
          {ready ? "Regenerate" : failed ? "Try again" : "Generate"}
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function ActivityDetails({
  stream,
  seconds,
  active,
  ready,
  initiallyExpanded = false,
}: {
  stream: DiagramStreamState;
  seconds: number;
  active: boolean;
  ready: boolean;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <details
      className={styles.details}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        Activity <ChevronDown size={12} aria-hidden="true" />
      </summary>
      <div className={styles.detailBody}>
        <ActivityContent
          stream={stream}
          seconds={seconds}
          active={active}
          ready={ready}
        />
      </div>
    </details>
  );
}

export function ActivityContent({
  stream,
  seconds,
  active,
  ready,
}: {
  stream: DiagramStreamState;
  seconds: number;
  active: boolean;
  ready: boolean;
}) {
  const step = generationStep(stream.status);
  return (
    <>
      <div className={styles.detailRow}>
        <FileCode2 size={14} aria-hidden="true" />
        {seconds >= 3 ? "12 source files read" : "Reading the repository"}
        {seconds >= 3 && <Check size={13} aria-hidden="true" />}
      </div>
      {step >= 2 && (
        <div className={styles.detailRow}>
          <Layers2 size={14} aria-hidden="true" />
          Architecture analyzed
          <Check size={13} aria-hidden="true" />
        </div>
      )}
      {stream.graph && !ready && (
        <div className={styles.detailRow}>
          <GitBranch size={14} aria-hidden="true" />
          {stream.graph.nodes.length} components · {stream.graph.edges.length}{" "}
          connections
        </div>
      )}
      <ArchitectureSummary stream={stream} active={active && !ready} />
    </>
  );
}

export function WorkThread({
  stream,
  seconds,
  active,
  ready,
}: {
  stream: DiagramStreamState;
  seconds: number;
  active: boolean;
  ready: boolean;
}) {
  const step = generationStep(stream.status);
  return (
    <div className={styles.workThread}>
      {seconds >= 1 && (
        <div className={styles.threadMilestone}>
          <Check size={13} aria-hidden="true" />
          <span>Repository found</span>
        </div>
      )}
      {seconds >= 3 && (
        <div className={styles.threadMilestone}>
          <Check size={13} aria-hidden="true" />
          <span>Source files read</span>
          <span className={styles.threadMeta}>12 files</span>
        </div>
      )}
      {step >= 2 && (
        <div className={styles.threadMilestone}>
          <Check size={13} aria-hidden="true" />
          <span>Architecture analyzed</span>
        </div>
      )}
      <ArchitectureSummary stream={stream} active={active} />
      {ready && (
        <div className={styles.threadMilestone}>
          <Check size={13} aria-hidden="true" />
          <span>Diagram ready</span>
        </div>
      )}
    </div>
  );
}

function ArchitectureSummary({
  stream,
  active,
}: {
  stream: DiagramStreamState;
  active: boolean;
}) {
  const excerpt = stream.explanation
    ?.split("\n")
    .find((line) => line.length > 30 && !line.startsWith("#"))
    ?.replace(/\*\*|`/g, "");
  if (!excerpt) return null;

  return (
    <div className={styles.excerpt}>
      <p>{excerpt}</p>
      <ArchitectureNotes
        text={stream.explanation}
        streaming={active && generationStep(stream.status) === 1}
      />
    </div>
  );
}
