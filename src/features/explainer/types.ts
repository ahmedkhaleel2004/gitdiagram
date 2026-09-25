// Shared shapes for the explainer video: the model's plan, the narration clock,
// and the stored artifact the browser player consumes.

/** The free-form shot language the scene engine (shots.js) draws. */
export interface ShotElement {
  id: string;
  kind:
    | "heading"
    | "text"
    | "code"
    | "terminal"
    | "box"
    | "chip"
    | "file"
    | "tree"
    | "table"
    | "bars"
    | "number"
    | "stamp"
    | "browser"
    | "request"
    | "list"
    | "svg"
    | "arrow";
  /** Canvas units: 16 × 9, one unit is 120 px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cue word; the element appears when it is spoken. */
  at: string;
  [field: string]: unknown;
}

export interface ShotAction {
  do:
    | "highlight"
    | "dim"
    | "restore"
    | "exit"
    | "strike"
    | "pulse"
    | "shake"
    | "check"
    | "cross"
    | "replace"
    | "count"
    | "move"
    | "type"
    | "flow"
    | "scan"
    | "focus"
    | "reset";
  at: string;
  target: string[];
  [field: string]: unknown;
}

export interface ShotBeat {
  scene: string;
  narration: string;
  /** Set on a scene's first beat only. */
  transition: string;
  elements: ShotElement[];
  actions: ShotAction[];
}

export interface ShotPlan {
  title: string;
  outro: string;
  beats: ShotBeat[];
}

export interface VideoMeta {
  owner: string;
  repo: string;
  url: string;
  description: string;
  stars: number;
  language: string;
}

export interface VideoWord {
  /** Normalized spoken word, matched against plan cues. */
  w: string;
  /** Start and end in seconds on the video clock. */
  s: number;
  e: number;
}

export interface VideoTiming {
  DURATION: number;
  SPEECH_END: number;
  beats: Array<{ start: number; end: number; words: VideoWord[] }>;
}

interface VideoGenerationStats {
  totalMs: number;
  readMs: number;
  planMs: number;
  /** Designing and narration run in parallel; this is the longer of the two. */
  voiceMs: number;
  planner: "api";
  model: string;
  /** Model cost at API list prices; null when the backend cannot report it. */
  plannerCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  ttsCharacters: number;
  warnings: string[];
}

export type VideoArtifact = {
  repository: string;
  createdAt: string;
  meta: VideoMeta;
  timing: VideoTiming;
  /** Narration clips placed at `start` seconds: one take for the whole film (older videos have one per scene). */
  voices: Array<{ start: number }>;
  stats: VideoGenerationStats;
  /** Version 1 (the template engine) is retired; only shot plans remain. */
  version: 2;
  plan: ShotPlan;
};

export type VideoGenerationStage =
  "reading" | "planning" | "designing" | "saving";

/** What a generation has done so far, for the live progress rows. */
export interface VideoGenerationProgress {
  sourceFiles?: number;
  scenes?: number;
  beats?: number;
  words?: number;
  /** The narration, one line per beat, once the script is written. */
  narration?: string[];
  designed?: number;
  voiced?: number;
}

export type VideoGenerationEvent =
  | {
      status: VideoGenerationStage;
      elapsedMs: number;
      progress?: VideoGenerationProgress;
    }
  | { status: "complete"; artifact: VideoArtifact }
  /** `retryable: false` means trying again cannot help (e.g. a private repo). */
  | { status: "error"; error: string; retryable?: boolean };

export type VideoRenderStep = "starting" | "rendering" | "finishing";

export type VideoRenderEvent =
  | { status: "rendering"; progress: number; step?: VideoRenderStep }
  | { status: "complete" }
  | { status: "error"; error: string };
