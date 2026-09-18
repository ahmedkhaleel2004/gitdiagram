"use client";

import { useEffect, useReducer } from "react";
import {
  demoDuration,
  demoState,
  DEMO_DIAGRAM,
  DEMO_PREVIOUS_DIAGRAM,
  type DemoScenario,
} from "./fixture";

export const APPROACHES = [
  {
    id: "inline",
    label: "Inline",
  },
  {
    id: "thread",
    label: "Thread",
  },
  {
    id: "canvas",
    label: "Canvas",
  },
] as const;
export type Approach = (typeof APPROACHES)[number]["id"];

interface PreviewState {
  runId: number;
  scenario: DemoScenario;
  seconds: number;
  playing: boolean;
  started: boolean;
  cancelled: boolean;
  speed: number;
  previousDiagram?: string;
}
type Action =
  | { type: "tick" }
  | { type: "play" }
  | { type: "reset" }
  | { type: "cancel" }
  | { type: "regenerate" }
  | { type: "scenario"; value: DemoScenario }
  | { type: "seek"; value: number }
  | { type: "speed"; value: number };

const initial: PreviewState = {
  runId: 0,
  scenario: "normal",
  seconds: 0,
  playing: false,
  started: false,
  cancelled: false,
  speed: 1,
};

function reset(state: PreviewState, scenario = state.scenario): PreviewState {
  return {
    ...initial,
    runId: state.runId + 1,
    speed: state.speed,
    scenario,
    previousDiagram:
      scenario === "regenerate" || scenario === "regenerate-error"
        ? DEMO_PREVIOUS_DIAGRAM
        : undefined,
  };
}

export function previewReducer(
  state: PreviewState,
  action: Action,
): PreviewState {
  const terminal =
    state.cancelled ||
    ["complete", "error"].includes(
      demoState(state.seconds, state.scenario).status,
    );
  switch (action.type) {
    case "tick":
      return state.playing && !terminal
        ? {
            ...state,
            seconds: Math.min(
              demoDuration(state.scenario),
              state.seconds + 0.1 * state.speed,
            ),
          }
        : state;
    case "play":
      return terminal
        ? {
            ...reset(state),
            previousDiagram: state.previousDiagram,
            playing: true,
            started: true,
          }
        : { ...state, started: true, playing: !state.playing };
    case "reset":
      return reset(state);
    case "scenario":
      return reset(state, action.value);
    case "seek":
      return {
        ...state,
        runId: state.runId + 1,
        seconds: action.value,
        started: true,
        playing: false,
        cancelled: false,
      };
    case "cancel":
      return { ...state, cancelled: true, playing: false };
    case "speed":
      return { ...state, speed: action.value };
    case "regenerate":
      return {
        ...reset(state, "regenerate"),
        previousDiagram: DEMO_DIAGRAM,
        playing: true,
        started: true,
      };
  }
}

export function usePreview() {
  const [preview, dispatch] = useReducer(previewReducer, initial);
  const stream = demoState(preview.seconds, preview.scenario);
  const terminal =
    preview.cancelled ||
    stream.status === "complete" ||
    stream.status === "error";
  useEffect(() => {
    if (!preview.playing || terminal) return;
    const timer = setInterval(() => dispatch({ type: "tick" }), 100);
    return () => clearInterval(timer);
  }, [preview.playing, terminal]);
  return { preview, stream, terminal, dispatch };
}
