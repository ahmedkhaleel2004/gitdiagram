"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type GapDiagnosis,
  PANEL_ENGINE_LABELS,
  PANEL_ENGINES,
  PANEL_GROUP_LABELS,
  type PanelReport,
  type PanelView,
  type PromptGap,
} from "~/features/admin/ai-panel";
import { percent } from "~/features/admin/visibility";
import { BarList, Panel, Tile, TOUCH } from "./ui";

// The weekly prompt panel: every question where an AI engine left GitDiagram
// out, why, and the one fix to make. Read once when the dashboard opens (and
// on Refresh): it changes once a week.

const SOFT = "text-[hsl(var(--neo-soft-text))]";

const DIAGNOSIS_STYLE: Record<GapDiagnosis, string> = {
  "missing page": "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-50",
  "weak page":
    "bg-amber-200 text-amber-950 dark:bg-amber-900/60 dark:text-amber-50",
  "inaccessible page":
    "bg-sky-200 text-sky-950 dark:bg-sky-900/60 dark:text-sky-50",
  "third-party gap":
    "bg-purple-200 text-purple-950 dark:bg-purple-900/60 dark:text-purple-50",
};

function EngineTiles({ report }: { report: PanelReport }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {PANEL_ENGINES.map((engine) => {
        const stats = report.engines[engine];
        return (
          <Tile
            key={engine}
            label={`${PANEL_ENGINE_LABELS[engine]}${report.models[engine] ? ` · ${report.models[engine]}` : ""}`}
            value={
              stats.answered ? percent(stats.mentioned, stats.answered) : "–"
            }
            meter={stats.answered ? stats.mentioned / stats.answered : null}
            sub={
              stats.answered
                ? `Named in ${stats.mentioned} of ${stats.answered} · linked ${stats.cited}${stats.mentioned ? ` · avg place #${(stats.positionSum / stats.mentioned).toFixed(1)}` : ""} · $${stats.costUsd.toFixed(2)}`
                : stats.asked
                  ? `${stats.asked} not answered (see a gap for why)`
                  : "Not asked"
            }
          />
        );
      })}
    </div>
  );
}

function Gap({ gap }: { gap: PromptGap }) {
  return (
    <details className="group py-1.5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm pointer-coarse:min-h-11">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${DIAGNOSIS_STYLE[gap.diagnosis]}`}
        >
          {gap.diagnosis}
        </span>
        <span className={`shrink-0 text-xs tabular-nums ${SOFT}`}>
          {gap.missedBy.length}/{gap.missedBy.length + gap.namedBy.length}
        </span>
        <span className="min-w-0 flex-1 truncate group-open:whitespace-normal">
          {gap.text}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2 rounded-md border-2 border-black bg-white/70 p-3 text-[13px] dark:bg-black/20">
        <p>
          <span className="font-semibold">Fix: </span>
          {gap.fix}
        </p>
        <p className={`text-xs ${SOFT}`}>
          {PANEL_GROUP_LABELS[gap.group]} · missed by{" "}
          {gap.missedBy.map((engine) => PANEL_ENGINE_LABELS[engine]).join(", ")}
          {gap.namedBy.length
            ? ` · named by ${gap.namedBy.map((engine) => PANEL_ENGINE_LABELS[engine]).join(", ")}`
            : ""}
          {gap.page ? ` · our page ${gap.page}` : " · no page of ours"}
          {gap.competitors.length
            ? ` · named instead: ${gap.competitors.join(", ")}`
            : ""}
        </p>
        {gap.citedInstead.length ? (
          <ul className="flex flex-col gap-0.5 text-xs [overflow-wrap:anywhere]">
            {gap.citedInstead.map(([url, engines]) => (
              <li key={url}>
                <span className="font-semibold tabular-nums">{engines}× </span>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`text-xs ${SOFT}`}>No pages cited.</p>
        )}
      </div>
    </details>
  );
}

const DIAGNOSES: GapDiagnosis[] = [
  "missing page",
  "weak page",
  "inaccessible page",
  "third-party gap",
];

export function PromptGapsPanel() {
  const [view, setView] = useState<PanelView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<GapDiagnosis | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/ai-panel", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        (PanelView & { error?: string }) | null;
      if (!response.ok || !body || !Array.isArray(body.history))
        throw new Error(body?.error ?? "Could not load. Try again.");
      setView(body);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const report = view?.latest ?? null;
  const gaps = report?.gaps.filter(
    (gap) => !filter || gap.diagnosis === filter,
  );
  return (
    <Panel
      title="Prompt gaps"
      aside={
        <span className="flex items-center gap-2">
          {report
            ? `Week of ${report.week} · ${report.finishedAt ? "done" : "still asking"} · $${report.costUsd.toFixed(2)}`
            : "Asked weekly, Mondays from 14:00 UTC"}
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className={`neo-button-muted h-7 rounded-md px-2 text-xs font-semibold ${TOUCH}`}
          >
            Refresh
          </button>
        </span>
      }
    >
      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {!report ? (
        <p className={`text-sm ${SOFT}`}>
          {loading ? "Loading…" : "No weekly run yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <p className={`mb-2 text-xs ${SOFT}`}>
              {report.prompts} real buyer questions, each asked to four engines
              with web search. Named by every engine on {report.covered};{" "}
              {report.gaps.length} have a gap.
            </p>
            <EngineTiles report={report} />
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <h3 className="mr-1 text-xs font-bold uppercase">Gaps</h3>
              {DIAGNOSES.map((diagnosis) => {
                const count = report.gaps.filter(
                  (gap) => gap.diagnosis === diagnosis,
                ).length;
                return (
                  <button
                    key={diagnosis}
                    type="button"
                    aria-pressed={filter === diagnosis}
                    onClick={() =>
                      setFilter(filter === diagnosis ? null : diagnosis)
                    }
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${TOUCH} ${DIAGNOSIS_STYLE[diagnosis]} ${filter && filter !== diagnosis ? "opacity-40" : ""}`}
                  >
                    {diagnosis} {count}
                  </button>
                );
              })}
            </div>
            <ul className="flex flex-col divide-y-2 divide-black/10 dark:divide-white/10">
              {gaps?.map((gap) => (
                <li key={gap.promptId}>
                  <Gap gap={gap} />
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase">
                Most-cited pages on our misses · outreach list
              </h3>
              <BarList rows={report.topCited.slice(0, 25)} />
            </div>
            <div className="flex flex-col gap-5">
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase">
                  Most-cited sites on our misses
                </h3>
                <BarList rows={report.topHosts.slice(0, 15)} />
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase">
                  Tools named instead
                </h3>
                <BarList rows={report.competitors.slice(0, 10)} />
              </div>
            </div>
          </div>
          {view?.history.length ? (
            <p className={`text-xs ${SOFT}`}>
              Earlier weeks:{" "}
              {view.history
                .map(
                  (week) =>
                    `${week.week} ${PANEL_ENGINES.map((engine) => `${PANEL_ENGINE_LABELS[engine]} ${percent(week.engines[engine].mentioned, week.engines[engine].answered)}`).join(", ")}`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
