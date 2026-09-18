"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  FileCode2,
  GitBranch,
  Layers2,
} from "lucide-react";
import type { DiagramStreamState } from "~/features/diagram/types";
import { ArchitectureNotes } from "./architecture-notes";
import { generationStep } from "./progress";
import styles from "./workspace.module.css";

export function GenerationActivity({
  state,
  lastGenerated,
}: {
  state: DiagramStreamState;
  lastGenerated?: Date;
}) {
  const step = generationStep(state.status);
  const streaming = [
    "explanation_sent",
    "explanation",
    "explanation_chunk",
  ].includes(state.status);
  const excerpt = state.explanation
    ?.split("\n")
    .find((part) => part.trim().length > 30 && !/^#/.test(part.trim()))
    ?.replace(/\*\*|`/g, "")
    .replace(/^[-*]\s+/gm, "")
    .slice(0, 700);
  return (
    <>
      {state.sourceFileCount !== undefined && (
        <div className={styles.detailRow}>
          <FileCode2 size={14} aria-hidden="true" />
          {state.sourceFileCount} source{" "}
          {state.sourceFileCount === 1 ? "file" : "files"} read
          <Check size={13} aria-hidden="true" />
        </div>
      )}
      {step >= 2 && state.explanation && (
        <div className={styles.detailRow}>
          <Layers2 size={14} aria-hidden="true" /> Architecture analyzed
          <Check size={13} aria-hidden="true" />
        </div>
      )}
      {state.graph && (
        <div className={styles.detailRow}>
          <GitBranch size={14} aria-hidden="true" />
          {state.graph.nodes.length} components · {state.graph.edges.length}{" "}
          connections
        </div>
      )}
      {state.explanation && (
        <div className={styles.excerpt}>
          {excerpt && <p>{excerpt}</p>}
          <ArchitectureNotes text={state.explanation} streaming={streaming} />
        </div>
      )}
      {(lastGenerated || state.costSummary) && (
        <div className={styles.metadata}>
          {lastGenerated && (
            <p>
              Last generated:{" "}
              <time dateTime={lastGenerated.toISOString()}>
                {lastGenerated.toLocaleString()}
              </time>
            </p>
          )}
          {state.costSummary && (
            <p>
              {state.costSummary.kind === "actual" ? "Actual" : "Estimated"}{" "}
              cost: {state.costSummary.display}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function ExpandedActivity({ state }: { state: DiagramStreamState }) {
  const [expanded, setExpanded] = useState(true);
  if (!state.explanation && state.sourceFileCount === undefined && !state.graph)
    return null;
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
        <GenerationActivity state={state} />
      </div>
    </details>
  );
}
