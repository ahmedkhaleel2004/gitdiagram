"use client";

import type { GenerationCostSummary } from "~/features/diagram/cost";
import type { GenerationSessionAudit } from "~/features/diagram/graph";

interface GenerationAuditPanelProps {
  audit: GenerationSessionAudit | null | undefined;
  error?: string;
}

export function GenerationAuditPanel({
  audit,
  error,
}: GenerationAuditPanelProps) {
  if (!audit && !error) {
    return null;
  }

  const renderCostSummary = (
    label: string,
    costSummary: GenerationCostSummary | null | undefined,
  ) => {
    if (!costSummary) {
      return null;
    }

    return (
      <div className="mt-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <p className="font-medium">{label}</p>
        <p className="mt-1">
          {costSummary.display}
        </p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(costSummary, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div className="w-full max-w-5xl rounded-xl border border-neutral-300 bg-white/80 p-4 text-sm text-neutral-800 shadow-sm dark:border-neutral-700 dark:bg-neutral-950/60 dark:text-neutral-100">
      <p className="font-semibold">
        {audit?.status === "failed"
          ? "Latest generation failed"
          : "Generation details"}
      </p>
      {error && <p className="mt-2 text-red-700 dark:text-red-300">{error}</p>}
      {audit?.failureStage && (
        <p className="mt-2 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Failure stage: {audit.failureStage}
        </p>
      )}
      {audit?.validationError && (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
          {audit.validationError}
        </pre>
      )}
      {renderCostSummary("Estimated cost", audit?.estimatedCost)}
      {renderCostSummary("Final cost", audit?.finalCost)}
      {audit?.stageUsages?.length ? (
        <div className="mt-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="font-medium">Stage usage</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(audit.stageUsages, null, 2)}
          </pre>
        </div>
      ) : null}
      {audit?.graphAttempts?.length ? (
        <div className="mt-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="font-medium">Graph attempts</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(audit.graphAttempts, null, 2)}
          </pre>
        </div>
      ) : null}
      {audit?.graph ? (
        <div className="mt-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="font-medium">Graph JSON</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(audit.graph, null, 2)}
          </pre>
        </div>
      ) : null}
      {audit?.compiledDiagram ? (
        <div className="mt-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="font-medium">Compiled Mermaid</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
            {audit.compiledDiagram}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
