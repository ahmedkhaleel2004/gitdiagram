"use client";

import { Minus, Plus, ScanSearch } from "lucide-react";

interface MermaidDiagramToolbarProps {
  formattedZoom: string;
  isPanZoomReady: boolean;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function MermaidDiagramToolbar({
  formattedZoom,
  isPanZoomReady,
  onFit,
  onZoomIn,
  onZoomOut,
}: MermaidDiagramToolbarProps) {
  return (
    <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-2">
      <div className="pointer-events-auto flex items-center overflow-hidden rounded-full border border-black/10 bg-white/80 shadow-[0_10px_30px_rgba(15,23,42,0.14)] ring-1 ring-white/70 backdrop-blur-md dark:border-white/10 dark:bg-[#101722]/78 dark:shadow-[0_12px_32px_rgba(0,0,0,0.32)] dark:ring-white/10">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={!isPanZoomReady}
          className="flex h-10 w-10 items-center justify-center text-black transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-100 dark:hover:bg-white/5"
          onClick={onZoomOut}
        >
          <Minus size={18} />
        </button>
        <div className="min-w-16 border-x border-black/10 px-3 text-center text-[11px] font-semibold tracking-[0.16em] text-black/80 uppercase dark:border-white/10 dark:text-neutral-100/80">
          {formattedZoom}
        </div>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={!isPanZoomReady}
          className="flex h-10 w-10 items-center justify-center text-black transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-100 dark:hover:bg-white/5"
          onClick={onZoomIn}
        >
          <Plus size={18} />
        </button>
      </div>
      <button
        type="button"
        disabled={!isPanZoomReady}
        className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full border border-black/10 bg-white/80 px-3 text-[11px] font-semibold tracking-[0.16em] text-black/80 uppercase shadow-[0_10px_30px_rgba(15,23,42,0.14)] ring-1 ring-white/70 backdrop-blur-md transition-colors hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-[#101722]/78 dark:text-neutral-100/80 dark:shadow-[0_12px_32px_rgba(0,0,0,0.32)] dark:ring-white/10 dark:hover:bg-[#18202c]/92"
        onClick={onFit}
      >
        <ScanSearch size={16} />
        Fit
      </button>
    </div>
  );
}
