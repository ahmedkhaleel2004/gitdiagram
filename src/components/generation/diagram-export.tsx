"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  Code2,
  Copy,
  Download,
  Image as ImageIcon,
  ImageDown,
} from "lucide-react";
import {
  exportMermaidSvgAsPng,
  withGitDiagramCredit,
} from "~/features/diagram/export";
import { readmeMarkdown, type ReadmeEmbed } from "~/features/diagram/readme";
import { captureAnalyticsEvent } from "~/lib/analytics-client";
import { TooltipProvider } from "~/components/ui/tooltip";
import { ExportAction } from "./export-action";
import styles from "./workspace.module.css";

export function DiagramExport({
  repository,
  diagram,
  getSvg,
  disabled = false,
  readme,
}: {
  /** owner/repo: both exports link back to its page. */
  repository: string;
  diagram: string;
  getSvg: () => SVGSVGElement | null;
  disabled?: boolean;
  /** Offered only for a stored public diagram. */
  readme?: { owner: string; repo: string };
}) {
  const [open, setOpen] = useState(false);
  const [pointerMotion, setPointerMotion] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const shared = (method: string) =>
    captureAnalyticsEvent("diagram_shared", {
      method,
      repository: readme ? `${readme.owner}/${readme.repo}` : null,
    });
  const copyReadme = async (kind: ReadmeEmbed) => {
    if (!readme) return;
    await navigator.clipboard.writeText(
      readmeMarkdown(readme.owner, readme.repo, kind),
    );
    shared(`readme_${kind}`);
  };

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPointerMotion(false);
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className={styles.exportControl} ref={container}>
      <button
        ref={trigger}
        type="button"
        className={styles.actionButton}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          setPointerMotion(event.detail !== 0);
          setOpen(!open);
        }}
      >
        <Download size={13} aria-hidden="true" /> Export{" "}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <div
        id={id}
        className={styles.exportMenu}
        role="group"
        aria-label="Export diagram"
        data-open={open}
        data-motion={pointerMotion}
        aria-hidden={!open}
        inert={!open}
      >
        <TooltipProvider delayDuration={350} skipDelayDuration={300}>
          <div className={styles.exportOptions}>
            <ExportAction
              label="Download PNG"
              successLabel="Downloaded"
              announcement="PNG downloaded"
              description="Save a high-resolution image of the diagram"
              errorMessage="Download failed. Try again."
              icon={ImageDown}
              onAction={async () => {
                const svg = getSvg();
                if (!svg) throw new Error("Diagram not ready");
                await exportMermaidSvgAsPng(
                  svg,
                  getComputedStyle(document.body).backgroundColor,
                  repository,
                );
                shared("png");
              }}
            />
            <ExportAction
              label="Copy Mermaid"
              successLabel="Copied"
              announcement="Mermaid copied"
              description="Copy the editable Mermaid diagram code"
              errorMessage="Copy failed. Try again."
              icon={Copy}
              onAction={async () => {
                await navigator.clipboard.writeText(
                  withGitDiagramCredit(diagram, repository),
                );
                shared("mermaid");
              }}
            />
            {readme && (
              <>
                <ExportAction
                  label="README picture"
                  successLabel="Copied"
                  announcement="README picture copied"
                  description="Copy Markdown for a picture of this diagram that opens it. It updates when the diagram does."
                  errorMessage="Copy failed. Try again."
                  icon={ImageIcon}
                  onAction={() => copyReadme("picture")}
                />
                <ExportAction
                  label="README badge"
                  successLabel="Copied"
                  announcement="README badge copied"
                  description="Copy Markdown for a README badge that opens this diagram"
                  errorMessage="Copy failed. Try again."
                  icon={Code2}
                  onAction={() => copyReadme("badge")}
                />
              </>
            )}
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
