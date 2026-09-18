"use client";

import type { RefObject } from "react";
import { ChevronDown, RotateCcw, Scan } from "lucide-react";
import { DiagramExport } from "./diagram-export";
import styles from "./workspace.module.css";

export function RepositoryToolbar({
  repository,
  diagram,
  historyId,
  historyVisible,
  toggleHistory,
  zooming,
  toggleZoom,
  onRegenerate,
  regenerateDisabled,
  regenerateRef,
  getSvg,
  pending,
}: {
  repository: string;
  diagram: string;
  historyId: string;
  historyVisible: boolean;
  toggleHistory: () => void;
  zooming: boolean;
  toggleZoom: () => void;
  onRegenerate: () => void;
  regenerateDisabled: boolean;
  regenerateRef: RefObject<HTMLButtonElement | null>;
  getSvg: () => SVGSVGElement | null;
  pending: boolean;
}) {
  return (
    <div className={styles.resultToolbar}>
      <h1 className={styles.repositoryTitle}>
        <a
          href={`https://github.com/${repository}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {repository}
        </a>
      </h1>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          disabled={pending}
          aria-expanded={historyVisible}
          aria-controls={historyId}
          onClick={toggleHistory}
        >
          Activity <ChevronDown size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          disabled={pending}
          aria-pressed={zooming}
          onClick={toggleZoom}
        >
          <Scan size={14} aria-hidden="true" />
          {zooming ? "Exit zoom" : "Enable zoom"}
        </button>
        <DiagramExport diagram={diagram} getSvg={getSvg} disabled={pending} />
        <button
          ref={regenerateRef}
          type="button"
          className={`${styles.actionButton} ${styles.primary}`}
          disabled={regenerateDisabled || pending}
          title={
            regenerateDisabled
              ? "Regeneration is disabled for example repositories."
              : undefined
          }
          onClick={onRegenerate}
        >
          <RotateCcw size={13} aria-hidden="true" /> Regenerate
        </button>
      </div>
    </div>
  );
}
