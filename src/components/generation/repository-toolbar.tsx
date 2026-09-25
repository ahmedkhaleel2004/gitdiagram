"use client";

import type { RefObject } from "react";
import { ChevronDown, Clapperboard, RotateCcw, Scan } from "lucide-react";
import { GitHubIcon } from "~/components/icons/github-icon";
import { DiagramExport } from "./diagram-export";
import { NewBadge } from "~/components/new-badge";
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
  video,
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
  video?: { id: string; open: boolean; toggle: () => void };
}) {
  return (
    <div className={styles.resultToolbar}>
      <h1 className={styles.repositoryTitle}>
        <a
          className={styles.actionButton}
          href={`https://github.com/${repository}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <GitHubIcon width={15} height={15} aria-hidden="true" />
          <span>{repository}</span>
        </a>
      </h1>
      <div className={styles.actions}>
        {video && (
          <button
            type="button"
            className={`${styles.actionButton} ${styles.primary} ${styles.videoToggle}`}
            aria-expanded={video.open}
            aria-controls={video.id}
            onClick={video.toggle}
          >
            <Clapperboard size={14} aria-hidden="true" />
            Video
            <NewBadge className="new-badge-light" />
          </button>
        )}
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
        {/* On phones the actions sit in two columns; Export lands in the right
            one after the Video button, so its menu opens toward the left. */}
        <div
          className={styles.exportSlot}
          data-column={video ? "right" : "left"}
        >
          <DiagramExport diagram={diagram} getSvg={getSvg} disabled={pending} />
        </div>
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
