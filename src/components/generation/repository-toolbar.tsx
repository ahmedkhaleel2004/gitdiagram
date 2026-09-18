"use client";

import { useEffect, useRef, type RefObject } from "react";
import { ChevronDown, GitBranch, Pencil, RotateCcw, Scan } from "lucide-react";
import type { GenerationCostSummary } from "~/features/diagram/cost";
import { DiagramExport } from "./diagram-export";
import { DiagramMetadata } from "./diagram-metadata";
import { RepositoryForm } from "./repository-form";
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
  pending,
  lastGenerated,
  cost,
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
  pending: boolean;
  lastGenerated?: Date;
  cost?: GenerationCostSummary;
}) {
  const [owner, name] = repository.split("/");
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!editing && wasEditing.current)
      editButton.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);
  return (
    <div className={styles.resultToolbar}>
      {editing ? (
        <RepositoryForm initialValue={repository} onClose={toggleEditing} />
      ) : (
        <div className={styles.resultIdentity}>
          <GitBranch size={24} aria-hidden="true" />
          <h1>
            <a
              href={`https://github.com/${repository}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{owner}/</span>
              <strong>{name}</strong>
            </a>
          </h1>
          <button
            ref={editButton}
            className={styles.editRepository}
            type="button"
            aria-label="Change repository"
            aria-expanded={editing}
            onClick={toggleEditing}
          >
            <Pencil size={15} aria-hidden="true" /> Edit
          </button>
        </div>
      )}
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
      <DiagramMetadata lastGenerated={lastGenerated} cost={cost} />
    </div>
  );
}
