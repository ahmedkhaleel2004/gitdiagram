"use client";

import { useEffect, useRef, useState } from "react";

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

export default function Loading({
  status = "idle",
  message,
  explanation,
  graph,
  graphAttempts,
  validationError,
  diagram,
  costSummary,
}: LoadingProps) {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [graphPlanningSeconds, setGraphPlanningSeconds] = useState(0);
  const [animatedDots, setAnimatedDots] = useState(".");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status === "idle" || status === "complete" || status === "error") {
      setAnimatedDots(".");
      return;
    }

    const dotStates = [".", "..", "..."];
    let dotIndex = 0;
    const interval = setInterval(() => {
      dotIndex = (dotIndex + 1) % dotStates.length;
      setAnimatedDots(dotStates[dotIndex] ?? ".");
    }, 450);

    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) {
      return;
    }

    requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
  }, [status, message, explanation, graph, graphAttempts, validationError, diagram]);

  useEffect(() => {
    if (!isGraphPlanningStatus(status) || graph) {
      setGraphPlanningSeconds(0);
      return;
    }

    setGraphPlanningSeconds(0);
    const interval = setInterval(() => {
      setGraphPlanningSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [graph, status]);

  const latestRawGraphAttempt = graphAttempts?.at(-1)?.rawOutput;
  const graphAttemptNumber = Math.min((graphAttempts?.length ?? 0) + 1, 3);
  const showGraphPlanningCard = isGraphPlanningStatus(status) && !graph;
  const showGraphAttemptBadge = graphAttemptNumber > 1;
  const baseHeaderMessage = message ?? messages[currentMessageIndex] ?? "";
  const headerMessage =
    status === "idle" || status === "complete" || status === "error"
      ? baseHeaderMessage
      : `${baseHeaderMessage.replace(/\.*\s*$/, "")}${animatedDots}`;
  const costLabel =
    costSummary?.kind === "actual" ? "Actual cost" : "Estimated cost";

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <div
        ref={scrollRef}
        className="max-h-[560px] overflow-y-auto rounded-xl border-2 border-purple-200 bg-purple-50/30 backdrop-blur-sm dark:border-[#2d1d4e] dark:bg-[linear-gradient(160deg,#1a1228,#150f22)]"
      >
        <div className="sticky top-0 z-20 border-b border-purple-100 bg-purple-100/95 px-6 py-3 backdrop-blur-sm dark:border-[#2d1d4e] dark:bg-[#1e1832]/95">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-medium text-purple-500 dark:text-[hsl(var(--neo-button-hover))]">
              {headerMessage}
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
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">{explanation}</p>
              </div>
            )}
            {showGraphPlanningCard ? (
              <div className="rounded-lg border border-purple-200 bg-purple-100/70 p-4 text-sm text-purple-950 dark:border-[#2d1d4e] dark:bg-[#221736]/70 dark:text-[hsl(var(--foreground))]">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium">Planning graph JSON...</p>
                  {showGraphAttemptBadge ? (
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-purple-700 dark:text-[hsl(var(--neo-link-hover))]">
                      Attempt {graphAttemptNumber}/3
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 leading-relaxed text-purple-900 dark:text-[hsl(var(--foreground))]">
                  The explanation is done. The model is now building the structured graph that
                  gets compiled into Mermaid.
                </p>
                <div className="mt-3 flex items-center gap-3 text-xs font-medium text-purple-700 dark:text-[hsl(var(--neo-link-hover))]">
                  <span className="inline-flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-purple-500 [animation-delay:-0.3s] dark:bg-[hsl(var(--neo-button-hover))]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-purple-500 [animation-delay:-0.15s] dark:bg-[hsl(var(--neo-button-hover))]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-purple-500 dark:bg-[hsl(var(--neo-button-hover))]" />
                  </span>
                  <span>{graphPlanningSeconds}s in this step</span>
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
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(graph, null, 2)}
                </pre>
              </div>
            )}
            {graphAttempts?.length ? (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-700 dark:bg-[#1a1228]/80 dark:text-[hsl(var(--foreground))]">
                <p className="font-medium text-purple-500 dark:text-[hsl(var(--neo-link-hover))]">
                  Graph attempts
                </p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(graphAttempts, null, 2)}
                </pre>
              </div>
            ) : null}
            {latestRawGraphAttempt ? (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-700 dark:bg-[#1a1228]/80 dark:text-[hsl(var(--foreground))]">
                <p className="font-medium text-purple-500 dark:text-[hsl(var(--neo-link-hover))]">
                  Latest graph raw output
                </p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {latestRawGraphAttempt}
                </pre>
              </div>
            ) : null}
            {validationError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-medium">Validation feedback</p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {validationError}
                </pre>
              </div>
            )}
            {diagram && (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-700 dark:bg-[#1a1228]/80 dark:text-[hsl(var(--foreground))]">
                <p className="font-medium text-purple-500 dark:text-[hsl(var(--neo-link-hover))]">
                  Compiled Mermaid
                </p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {diagram}
                </pre>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
