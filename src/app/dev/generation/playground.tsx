"use client";

import { loadDiagramRenderer } from "~/components/generation/load-diagram-renderer";

import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, FlaskConical } from "lucide-react";
import { GenerationWorkspace } from "~/components/generation/generation-workspace";
import { DiagramResult } from "~/components/generation/diagram-result";
import {
  DEMO_REPOSITORY,
  demoDuration,
  demoState,
  type DemoScenario,
} from "./fixture";

export default function GenerationPlayground({
  focused = false,
}: {
  focused?: boolean;
}) {
  const [showControls, setShowControls] = useState(!focused);
  const [scenario, setScenario] = useState<DemoScenario>("normal");
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [cancelled, setCancelled] = useState(false);
  const [run, setRun] = useState(0);
  const state = demoState(seconds, scenario);
  const terminal =
    cancelled || state.status === "complete" || state.status === "error";
  const duration = demoDuration(scenario);

  useEffect(() => {
    void loadDiagramRenderer();
  }, []);
  useEffect(() => {
    if (!playing || terminal) return;
    const timer = setInterval(
      () => setSeconds((time) => Math.min(duration, time + 0.1 * speed)),
      100,
    );
    return () => clearInterval(timer);
  }, [playing, terminal, speed, duration]);

  function restart(startPlaying = false) {
    setSeconds(0);
    setCancelled(false);
    setPlaying(startPlaying);
    setRun((value) => value + 1);
  }

  return (
    <main
      className={`mx-auto w-full max-w-[1144px] px-5 py-10 sm:px-8 ${!showControls ? "flex min-h-[calc(100svh-142px)] flex-col items-center justify-center" : ""}`}
    >
      {showControls && (
        <>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[.13em] text-[hsl(var(--neo-link))] uppercase">
                <FlaskConical size={14} aria-hidden="true" /> Local playground
              </p>
              <h1 className="text-2xl font-semibold tracking-[-.03em]">
                Generation preview
              </h1>
              <p className="mt-3 text-sm text-[hsl(var(--neo-soft-text))]">
                Same interface. Simulated responses. No API calls or credits
                used.
              </p>
            </div>
          </div>
          <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-black/15 bg-white/35 p-3 text-xs dark:border-white/15 dark:bg-white/5">
            <button
              type="button"
              className="flex min-h-10 min-w-36 items-center justify-center gap-2 rounded-md bg-purple-700 px-4 text-xs font-medium text-white hover:bg-purple-800 dark:bg-purple-300 dark:text-purple-950 dark:hover:bg-purple-200"
              onClick={() =>
                terminal ? restart(true) : setPlaying((value) => !value)
              }
            >
              {playing && !terminal ? (
                <Pause size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              {terminal
                ? "Replay preview"
                : playing
                  ? "Pause preview"
                  : seconds === 0
                    ? "Play preview"
                    : "Resume preview"}
            </button>
            <label className="flex flex-col gap-1.5 text-[10px] text-[hsl(var(--neo-soft-text))]">
              Scenario
              <select
                aria-label="Scenario"
                className="min-h-10 rounded-md border border-black/20 bg-[hsl(var(--neo-subtle))] px-2 text-xs text-[hsl(var(--foreground))] dark:border-white/20 dark:bg-[#231c2e]"
                value={scenario}
                onChange={(event) => {
                  setScenario(event.target.value as DemoScenario);
                  restart();
                }}
              >
                <option value="normal">Normal generation</option>
                <option value="slow">Slow first response</option>
                <option value="stalled">Missing connection updates</option>
                <option value="retry">Automatic refinement</option>
                <option value="error">Connection error</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] text-[hsl(var(--neo-soft-text))]">
              Speed
              <select
                aria-label="Playback speed"
                className="min-h-10 rounded-md border border-black/20 bg-[hsl(var(--neo-subtle))] px-2 text-xs text-[hsl(var(--foreground))] dark:border-white/20 dark:bg-[#231c2e]"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                <option value=".5">0.5×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="4">4×</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] text-[hsl(var(--neo-soft-text))]">
              Jump to
              <select
                aria-label="Jump to stage"
                className="min-h-10 rounded-md border border-black/20 bg-[hsl(var(--neo-subtle))] px-2 text-xs text-[hsl(var(--foreground))] dark:border-white/20 dark:bg-[#231c2e]"
                value=""
                onChange={(event) => {
                  setSeconds(Number(event.target.value));
                  setCancelled(false);
                  setPlaying(false);
                }}
              >
                <option value="" disabled>
                  Choose a stage
                </option>
                <option value="0">Initial state</option>
                <option
                  value={
                    scenario === "slow" || scenario === "stalled" ? "40" : "4"
                  }
                >
                  Waiting before text
                </option>
                <option value={scenario === "slow" ? "65" : "10"}>
                  Streaming notes
                </option>
                <option value={scenario === "slow" ? "73" : "18"}>
                  Connecting
                </option>
                <option
                  value={
                    scenario === "slow"
                      ? "79"
                      : scenario === "retry"
                        ? "32"
                        : "24"
                  }
                >
                  Drawing / error
                </option>
                <option value={duration}>Finished</option>
              </select>
            </label>
            <button
              type="button"
              className="ml-auto flex min-h-10 items-center gap-2 rounded-md px-3 text-[hsl(var(--neo-soft-text))] hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => restart()}
            >
              <RotateCcw size={14} aria-hidden="true" /> Reset
            </button>
          </div>
        </>
      )}
      {state.status === "complete" && !cancelled ? (
        <DiagramResult
          key={`result-${run}`}
          diagram={state.diagram!}
          repository={DEMO_REPOSITORY}
          explanation={state.explanation}
          graph={state.graph}
          zoomingEnabled
        />
      ) : (
        <GenerationWorkspace
          key={run}
          startedAt={0}
          lastActivityAt={
            seconds > 1
              ? scenario === "stalled"
                ? 0
                : seconds * 1000
              : undefined
          }
          sourceFileCount={seconds >= 3 ? 12 : undefined}
          elapsedSeconds={seconds}
          paused={!playing || terminal}
          status={cancelled ? "error" : state.status}
          repository={DEMO_REPOSITORY}
          explanation={state.explanation}
          graph={state.graph}
          error={
            cancelled
              ? "You stopped this generation. You can start again whenever you’re ready."
              : state.error
          }
          cancelled={cancelled}
          onCancel={() => {
            setCancelled(true);
            setPlaying(false);
          }}
          recovery={
            <button
              type="button"
              className="rounded-md px-4 py-2 text-xs font-medium"
              onClick={() => restart(true)}
            >
              Try again
            </button>
          }
        />
      )}
      <button
        type="button"
        className="mx-auto mt-4 block min-h-11 px-4 text-center text-[11px] text-[hsl(var(--neo-soft-text))] opacity-60 hover:opacity-100"
        onClick={() => setShowControls((value) => !value)}
      >
        {showControls ? "Hide preview controls" : "Preview controls"}
      </button>
    </main>
  );
}
