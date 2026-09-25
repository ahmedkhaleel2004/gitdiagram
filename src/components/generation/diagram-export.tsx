"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Copy, Download, FileCode, ImageDown } from "lucide-react";
import {
  exportMermaidSvgAsPng,
  exportMermaidSvgAsSvg,
} from "~/features/diagram/export";
import { TooltipProvider } from "~/components/ui/tooltip";
import { ExportAction } from "./export-action";
import styles from "./workspace.module.css";

export function DiagramExport({
  diagram,
  getSvg,
  disabled = false,
}: {
  diagram: string;
  getSvg: () => SVGSVGElement | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pointerMotion, setPointerMotion] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

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
                );
              }}
            />
            <ExportAction
              label="Download SVG"
              successLabel="Downloaded"
              announcement="SVG downloaded"
              description="Save a scalable vector version of the diagram"
              errorMessage="Download failed. Try again."
              icon={FileCode}
              onAction={async () => {
                const svg = getSvg();
                if (!svg) throw new Error("Diagram not ready");
                exportMermaidSvgAsSvg(svg);
              }}
            />
            <ExportAction
              label="Copy Mermaid"
              successLabel="Copied"
              announcement="Mermaid copied"
              description="Copy the editable Mermaid diagram code"
              errorMessage="Copy failed. Try again."
              icon={Copy}
              onAction={() => navigator.clipboard.writeText(diagram)}
            />
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
