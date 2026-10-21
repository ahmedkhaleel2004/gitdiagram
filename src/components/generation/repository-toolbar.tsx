"use client";

import type { RefObject } from "react";
import { ChevronDown, Clapperboard, GitBranch, RotateCcw, Scan } from "lucide-react";
import { GitHubIcon } from "~/components/icons/github-icon";
import { DiagramExport } from "./diagram-export";
import { NewBadge } from "~/components/new-badge";
import styles from "./workspace.module.css";

export function RepositoryToolbar({
  repository,
  branch,
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
  readme,
}: {
  repository: string;
  branch?: string;
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
  readme?: { owner: string; repo: string };
}) {
  return (
    <div className={styles.resultToolbar}>
      <h1 className={styles.repositoryTitle}>
        <a
          className={styles.actionButton}
          href={
            branch
              ? `https://github.com/${repository}/tree/${branch}`
              : `https://github.com/${repository}`
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          <GitHubIcon width={15} height={15} aria-hidden="true" />
          <span>{repository}</span>
          {branch && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                fontSize: "0.75rem",
                padding: "0.125rem 0.375rem",
                borderRadius: "0.25rem",
                opacity: 0.85,
              }}
            >
              <GitBranch size={12} aria-hidden="true" />
              <span>{branch}</span>
            </span>
          )}
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
          Info <ChevronDown size={12} aria-hidden="true" />
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
          <DiagramExport
            repository={repository}
            diagram={diagram}
            getSvg={getSvg}
            disabled={pending}
            readme={readme}
          />
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
