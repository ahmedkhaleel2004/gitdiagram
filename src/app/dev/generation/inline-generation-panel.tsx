"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, GitBranch, RotateCcw, Scan } from "lucide-react";
import type { DiagramStreamState } from "~/features/diagram/types";
import { ActivityContent } from "./concept-parts";
import styles from "./concept.module.css";
import { PreviewExport } from "./preview-export";
import { DEMO_REPOSITORY } from "./fixture";

export function InlineGenerationPanel({
  ready,
  stream,
  seconds,
  zooming,
  onToggleZoom,
  onRegenerate,
  getSvg,
  children,
}: {
  ready: boolean;
  stream: DiagramStreamState;
  seconds: number;
  zooming: boolean;
  onToggleZoom: () => void;
  onRegenerate: () => void;
  getSvg: () => SVGSVGElement | null;
  children: ReactNode;
}) {
  const [showActivity, setShowActivity] = useState(false);
  const historyId = useId();
  const historyVisible = ready && showActivity;
  const work = useRef<HTMLDivElement>(null);
  const regenerate = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (ready && work.current?.contains(document.activeElement)) {
      regenerate.current?.focus({ preventScroll: true });
    }
  }, [ready]);

  return (
    <div className={styles.inlinePanel}>
      <div
        className={`${styles.fold} ${styles.toolbarFold}`}
        data-open={ready}
        aria-hidden={!ready}
        inert={!ready}
      >
        <div className={styles.foldClip}>
          <div className={styles.resultToolbar}>
            <a
              className={styles.resultRepository}
              href={`https://github.com/${DEMO_REPOSITORY}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitBranch size={15} aria-hidden="true" />
              <span>{DEMO_REPOSITORY}</span>
            </a>
            <div className={styles.resultActions}>
              <button
                type="button"
                aria-expanded={historyVisible}
                aria-controls={historyId}
                onClick={() => setShowActivity((value) => !value)}
              >
                Activity <ChevronDown size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={zooming}
                onClick={onToggleZoom}
              >
                <Scan size={14} aria-hidden="true" />
                {zooming ? "Exit zoom" : "Enable zoom"}
              </button>
              <PreviewExport diagram={stream.diagram ?? ""} getSvg={getSvg} />
              <button
                ref={regenerate}
                type="button"
                className={styles.regenerateAction}
                onClick={onRegenerate}
              >
                <RotateCcw size={13} aria-hidden="true" /> Regenerate
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        ref={work}
        className={styles.fold}
        data-open={!ready}
        aria-hidden={ready}
        inert={ready}
      >
        <div className={styles.foldClip}>
          <div className={styles.generationWork}>{children}</div>
        </div>
      </div>
      <div
        id={historyId}
        className={styles.fold}
        data-open={historyVisible}
        aria-hidden={!historyVisible}
        inert={!historyVisible}
      >
        <div className={styles.foldClip}>
          <div className={styles.resultActivity}>
            <ActivityContent
              stream={stream}
              seconds={seconds}
              active={false}
              ready={ready}
            />
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">
        {ready ? "Diagram ready" : ""}
      </span>
    </div>
  );
}
