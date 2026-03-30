"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "~/components/ui/skeleton";

const loadMermaidChart = () => import("~/components/mermaid-diagram");

const MermaidChart = dynamic(loadMermaidChart, {
  ssr: false,
  loading: () => (
    <div className="flex h-[248px] items-center justify-center px-6 text-center text-xs font-semibold tracking-[0.18em] text-[hsl(var(--neo-soft-text))] uppercase dark:text-neutral-300">
      Rendering preview
    </div>
  ),
});

export function preloadBrowseDiagramPreviewChart() {
  void loadMermaidChart();
}

interface BrowseDiagramPreviewProps {
  chart: string | null;
  repoLabel: string;
  status: "loading" | "ready" | "error";
}

const PREVIEW_BODY_CLASS = "h-[248px]";

export function BrowseDiagramPreview({
  chart,
  repoLabel,
  status,
}: BrowseDiagramPreviewProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="mermaid-preview"
      className="neo-panel w-[360px] overflow-hidden rounded-lg"
    >
      <div className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] px-4 py-3 text-[11px] font-semibold tracking-[0.18em] uppercase dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
        Preview
      </div>
      <div className="border-b border-black/10 px-4 py-2 text-sm font-semibold break-all dark:border-white/10">
        {repoLabel}
      </div>

      {status === "loading" ? (
        <div className={`flex flex-col gap-3 p-4 ${PREVIEW_BODY_CLASS}`}>
          <Skeleton className="h-4 w-24 shrink-0" />
          <Skeleton className="w-full flex-1" />
        </div>
      ) : status === "error" || !chart ? (
        <div
          className={`flex items-center justify-center px-6 text-center text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300 ${PREVIEW_BODY_CLASS}`}
        >
          Preview unavailable.
        </div>
      ) : (
        <MermaidChart
          chart={chart}
          zoomingEnabled={false}
          backgroundColor="transparent"
          containerClassName={`${PREVIEW_BODY_CLASS} overflow-hidden p-0`}
          diagramClassName="overflow-hidden bg-[hsl(var(--neo-panel))] px-2 py-3 dark:bg-[hsl(var(--neo-panel-muted))] [&_svg]:h-full [&_svg]:w-full"
        />
      )}
    </div>
  );
}
