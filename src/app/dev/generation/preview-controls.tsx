"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { demoDuration, type DemoScenario } from "./fixture";
import type { usePreview } from "./use-preview";
import styles from "./playground.module.css";

export function PreviewControls({
  preview,
  terminal,
  dispatch,
}: Pick<ReturnType<typeof usePreview>, "preview" | "terminal" | "dispatch">) {
  const duration = demoDuration(preview.scenario);
  const slow = preview.scenario === "slow";
  const refinement = preview.scenario === "retry";
  return (
    <div className={styles.controls} id="preview-controls">
      <div className={styles.controlRow}>
        <button
          className={styles.play}
          type="button"
          onClick={() => dispatch({ type: "play" })}
        >
          {preview.playing && !terminal ? (
            <Pause size={13} aria-hidden="true" />
          ) : (
            <Play size={13} aria-hidden="true" />
          )}
          {terminal
            ? "Replay"
            : preview.playing
              ? "Pause"
              : preview.started
                ? "Resume"
                : "Play"}
        </button>
        <label className={styles.selectLabel}>
          Scenario
          <select
            aria-label="Scenario"
            value={preview.scenario}
            onChange={(event) =>
              dispatch({
                type: "scenario",
                value: event.target.value as DemoScenario,
              })
            }
          >
            <option value="normal">Normal generation</option>
            <option value="slow">Slow first response</option>
            <option value="regenerate">Regenerate existing</option>
            <option value="regenerate-error">Regeneration error</option>
            <option value="retry">Automatic refinement</option>
            <option value="stalled">Connection goes quiet</option>
            <option value="error">Connection error</option>
          </select>
        </label>
        <label className={styles.selectLabel}>
          Speed
          <select
            aria-label="Playback speed"
            value={preview.speed}
            onChange={(event) =>
              dispatch({ type: "speed", value: Number(event.target.value) })
            }
          >
            <option value=".5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
        </label>
        <label className={styles.selectLabel}>
          Jump to
          <select
            aria-label="Jump to stage"
            value=""
            onChange={(event) =>
              dispatch({ type: "seek", value: Number(event.target.value) })
            }
          >
            <option value="" disabled>
              Choose a moment
            </option>
            <option value="0">First acknowledgement</option>
            <option value={slow || preview.scenario === "stalled" ? 40 : 4}>
              Waiting for the model
            </option>
            <option value={slow ? 65 : 10}>Architecture arriving</option>
            <option value={slow ? 73 : 18}>Mapping connections</option>
            <option value={slow ? 79 : refinement ? 32 : 24}>
              Drawing / error
            </option>
            <option value={duration}>Finished</option>
          </select>
        </label>
        <button
          className={styles.reset}
          type="button"
          onClick={() => dispatch({ type: "reset" })}
          aria-label="Reset preview"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.timeline}>
        <label htmlFor="preview-time" className="sr-only">
          Preview time
        </label>
        <input
          id="preview-time"
          type="range"
          min="0"
          max={duration}
          step=".1"
          value={preview.seconds}
          onChange={(event) =>
            dispatch({ type: "seek", value: Number(event.target.value) })
          }
        />
        <span>
          {Math.floor(preview.seconds)} / {duration}s
        </span>
      </div>
    </div>
  );
}
