"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { GenerationCostSummary } from "~/features/diagram/cost";
import type { GraphAttemptAudit, DiagramGraph } from "~/features/diagram/graph";
import type { DiagramStreamStatus } from "~/features/diagram/types";

const messages = [
  "Checking cached state...",
  "Analyzing repository...",
  "Planning graph structure...",
  "Compiling Mermaid...",
  "Trying to keep this fast...",
];

interface LoadingProps {
  costSummary?: GenerationCostSummary;
  status: DiagramStreamStatus;
  message?: string;
  explanation?: string;
  graph?: DiagramGraph;
  graphAttempts?: GraphAttemptAudit[];
  validationError?: string;
  diagram?: string;
}

function getStepNumber(status: DiagramStreamStatus): number {
  if (status === "diagram_compiling" || status === "complete") return 3;
  if (
    status === "graph_sent" ||
    status === "graph" ||
    status === "graph_retry" ||
    status === "graph_validating"
  ) {
    return 2;
  }
  if (
    status === "explanation_sent" ||
    status === "explanation" ||
    status === "explanation_chunk"
  ) {
    return 1;
  }
  return 0;
}

function isGraphPlanningStatus(status: DiagramStreamStatus): boolean {
  return (
    status === "graph_sent" ||
    status === "graph" ||
    status === "graph_retry" ||
    status === "graph_validating"
  );
}

function LoadingHeaderMessage({
  message,
  status,
}: {
  message?: string;
  status: DiagramStreamStatus;
}) {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const isActive =
    status !== "idle" && status !== "complete" && status !== "error";

  useEffect(() => {
    if (message) return;

    const interval = setInterval(() => {
      setCurrentMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [message]);

  const baseMessage = message ?? messages[currentMessageIndex] ?? "";
  const normalizedMessage = isActive
    ? baseMessage.replace(/\.*\s*$/, "")
    : baseMessage;

  return (
    <>
      {normalizedMessage}
      {isActive ? (
        <span aria-hidden="true" className="loading-ellipsis">
          ...
        </span>
      ) : null}
    </>
  );
}

function GraphPlanningTimer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((currentSeconds) => currentSeconds + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return <span>{seconds}s in this step</span>;
}

export default function Loading({
  status,
  message,
  explanation,
  graph,
  graphAttempts,
  validationError,
  diagram,
  costSummary,
}: LoadingProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [
    status,
    message,
    explanation,
    graph,
    graphAttempts,
    validationError,
    diagram,
  ]);

  const latestRawGraphAttempt = graphAttempts?.at(-1)?.rawOutput;
  const graphAttemptNumber = Math.min((graphAttempts?.length ?? 0) + 1, 3);
  const showGraphPlanningCard = isGraphPlanningStatus(status) && !graph;
  const showGraphAttemptBadge = graphAttemptNumber > 1;
  const serializedGraph = useMemo(
    () => (graph ? JSON.stringify(graph, null, 2) : null),
    [graph],
  );
  const serializedGraphAttempts = useMemo(
    () =>
      graphAttempts?.length ? JSON.stringify(graphAttempts, null, 2) : null,
    [graphAttempts],
  );
  const costLabel =
    costSummary?.kind === "actual" ? "Actual cost" : "Estimated cost";

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <div
        ref={scrollRef}
        className="max-h-[560px] overflow-y-auto rounded-xl border-2 border-purple-200 bg-purple-50/30 backdrop-blur-sm dark:border-[#2d1d4e] dark:bg-[linear-gradient(160deg,#1a1228,#150f22)]"
        data-testid="generation-stream"
      >
        <div className="sticky top-0 z-20 border-b border-purple-100 bg-purple-100/95 px-6 py-3 backdrop-blur-sm dark:border-[#2d1d4e] dark:bg-[#1e1832]/95">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-medium text-purple-500 dark:text-[hsl(var(--neo-button-hover))]">
              <LoadingHeaderMessage message={message} status={status} />
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs font-medium text-purple-500 dark:text-[hsl(var(--foreground))]">
              {costSummary && (
                <span>
                  {costLabel}: {costSummary.display}
                </span>
              )}
              <span className="rounded-full bg-purple-100 px-2 py-0.5 dark:bg-[#251b3a]">
                Step {getStepNumber(status)}/3
              </span>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="flex flex-col gap-4">
            {explanation && (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-700 dark:bg-[#1a1228]/80 dark:text-[hsl(var(--foreground))]">
                <p className="font-medium text-purple-500 dark:text-[hsl(var(--neo-link-hover))]">
                  Explanation
                </p>
                <p className="mt-2 leading-relaxed whitespace-pre-wrap">
                  {explanation}
                </p>
              </div>
            )}
            {showGraphPlanningCard ? (
              <div className="rounded-lg border border-purple-200 bg-purple-100/70 p-4 text-sm text-purple-950 dark:border-[#2d1d4e] dark:bg-[#221736]/70 dark:text-[hsl(var(--foreground))]">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium">Planning graph JSON...</p>
                  {showGraphAttemptBadge ? (
                    <span className="text-xs font-medium tracking-[0.18em] text-purple-700 uppercase dark:text-[hsl(var(--neo-link-hover))]">
                      Attempt {graphAttemptNumber}/3
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 leading-relaxed text-purple-900 dark:text-[hsl(var(--foreground))]">
                  The explanation is done. The model is now building the
                  structured graph that gets compiled into Mermaid.
                </p>
                <div className="mt-3 flex items-center gap-3 text-xs font-medium text-purple-700 dark:text-[hsl(var(--neo-link-hover))]">
                  <span className="inline-flex gap-1">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-purple-500 [animation-delay:-0.24s] [animation-duration:1.2s] dark:bg-[hsl(var(--neo-button-hover))]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-purple-500 [animation-delay:-0.12s] [animation-duration:1.2s] dark:bg-[hsl(var(--neo-button-hover))]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-purple-500 [animation-duration:1.2s] dark:bg-[hsl(var(--neo-button-hover))]" />
                  </span>
                  <GraphPlanningTimer />
                </div>
                <pre className="mt-4 overflow-x-auto rounded-md bg-purple-50/90 p-3 text-xs leading-relaxed text-purple-950 dark:bg-[#181126] dark:text-[hsl(var(--foreground))]">
                  {`{
  "groups": [...],
  "nodes": [...],
  "edges": [...]
}`}
                </pre>
              </div>
            ) : null}
            {graph && (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-700 dark:bg-[#1a1228]/80 dark:text-[hsl(var(--foreground))]">
                <p className="font-medium text-purple-500 dark:text-[hsl(var(--neo-link-hover))]">
                  Graph JSON
                </p>
                <pre className="mt-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {serializedGraph}
                </pre>
              </div>
            )}
            {graphAttempts?.length ? (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-700 dark:bg-[#1a1228]/80 dark:text-[hsl(var(--foreground))]">
                <p className="font-medium text-purple-500 dark:text-[hsl(var(--neo-link-hover))]">
                  Graph attempts
                </p>
                <pre className="mt-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {serializedGraphAttempts}
                </pre>
              </div>
            ) : null}
            {latestRawGraphAttempt ? (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-700 dark:bg-[#1a1228]/80 dark:text-[hsl(var(--foreground))]">
                <p className="font-medium text-purple-500 dark:text-[hsl(var(--neo-link-hover))]">
                  Latest graph raw output
                </p>
                <pre className="mt-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {latestRawGraphAttempt}
                </pre>
              </div>
            ) : null}
            {validationError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-medium">Validation feedback</p>
                <pre className="mt-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {validationError}
                </pre>
              </div>
            )}
            {diagram && (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-700 dark:bg-[#1a1228]/80 dark:text-[hsl(var(--foreground))]">
                <p className="font-medium text-purple-500 dark:text-[hsl(var(--neo-link-hover))]">
                  Compiled Mermaid
                </p>
                <pre className="mt-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {diagram}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
