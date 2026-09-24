// Shared shapes for the explainer video: the model's plan, the narration clock,
// and the stored artifact the browser player consumes.

export const VIDEO_SCENE_TYPES = [
  "hook",
  "stack",
  "tree",
  "flow",
  "code",
  "graph",
  "checklist",
  "stream",
  "stats",
  "compare",
  "idea",
  "close",
] as const;

export type VideoSceneType = (typeof VIDEO_SCENE_TYPES)[number];

/** Scene fields vary by type; the scene engine reads them, the schema bounds them. */
export type VideoScene = { type: VideoSceneType } & Record<string, unknown>;

export interface VideoBeat {
  chapter: string;
  narration: string;
  scene: VideoScene;
}

export interface VideoGraph {
  groups: Array<{ id: string; label: string }>;
  nodes: Array<{
    id: string;
    label: string;
    sub: string;
    group: string;
    kind: string;
  }>;
  edges: Array<{ from: string; to: string; label: string }>;
}

export interface VideoPlan {
  title: string;
  hook: string;
  idea: { teaser: string; statement: string; emphasis: string } | null;
  beats: VideoBeat[];
  takeaway: Array<{ text: string; cue: string }>;
  startHere: { path: string; files: string[] };
  architecture: VideoGraph;
}

/** Version 2: a free-form shot language the scene engine (shots.js) draws. */
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

export interface VideoGenerationStats {
  totalMs: number;
  readMs: number;
  planMs: number;
  /** Designing and narration run in parallel; this is the longer of the two. */
  voiceMs: number;
  planner: "api" | "cli";
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
  /** Narration clips (one per scene in version 2, per beat in version 1), placed at `start` seconds. */
  voices: Array<{ start: number }>;
  stats: VideoGenerationStats;
} & ({ version: 1; plan: VideoPlan } | { version: 2; plan: ShotPlan });

export type VideoGenerationStage =
  "reading" | "planning" | "designing" | "saving";

export type VideoGenerationEvent =
  | { status: VideoGenerationStage; elapsedMs: number }
  | { status: "complete"; artifact: VideoArtifact }
  | { status: "error"; error: string };
