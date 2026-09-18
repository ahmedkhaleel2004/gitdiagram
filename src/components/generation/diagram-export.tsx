"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Copy, Download, ImageDown } from "lucide-react";
import { exportMermaidSvgAsPng } from "~/features/diagram/export";
import styles from "./workspace.module.css";

export function DiagramExport({
  diagram,
  getSvg,
}: {
  diagram: string;
  getSvg: () => SVGSVGElement | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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

  async function exportDiagram(format: "png" | "mermaid") {
    setBusy(true);
    setMessage("");
    try {
      if (format === "png") {
        const svg = getSvg();
        if (!svg) throw new Error("Diagram not ready");
        await exportMermaidSvgAsPng(
          svg,
          getComputedStyle(document.body).backgroundColor,
        );
        setMessage("PNG downloaded");
      } else {
        await navigator.clipboard.writeText(diagram);
        setMessage("Mermaid copied");
      }
    } catch {
      setMessage(
        format === "png"
          ? "Download failed. Try again."
          : "Copy failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.exportControl} ref={container}>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
          setMessage("");
        }}
      >
        <Download size={13} aria-hidden="true" /> Export{" "}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          className={styles.exportMenu}
          role="group"
          aria-label="Export diagram"
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportDiagram("png")}
          >
            <ImageDown size={14} aria-hidden="true" /> Download PNG
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportDiagram("mermaid")}
          >
            <Copy size={14} aria-hidden="true" /> Copy Mermaid
          </button>
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </div>
  );
}
