"use client";

import type { RefObject } from "react";
import { ChevronDown, GitBranch, Pencil, RotateCcw, Scan } from "lucide-react";
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
  editing,
  toggleEditing,
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
  editing: boolean;
  toggleEditing: () => void;
}) {
  return (
    <div className={styles.resultToolbar}>
      <div className={styles.repositoryLink}>
        <GitBranch size={15} aria-hidden="true" />
        <a
          href={`https://github.com/${repository}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {repository}
        </a>
        <button
          className={styles.editRepository}
          type="button"
          aria-label="Change repository"
          aria-expanded={editing}
          onClick={toggleEditing}
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          aria-expanded={historyVisible}
          aria-controls={historyId}
          onClick={toggleHistory}
        >
          Activity <ChevronDown size={12} aria-hidden="true" />
        </button>
        <button type="button" aria-pressed={zooming} onClick={toggleZoom}>
          <Scan size={14} aria-hidden="true" />
          {zooming ? "Exit zoom" : "Enable zoom"}
        </button>
        <DiagramExport diagram={diagram} getSvg={getSvg} />
        <button
          ref={regenerateRef}
          type="button"
          className={styles.primary}
          disabled={regenerateDisabled}
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
