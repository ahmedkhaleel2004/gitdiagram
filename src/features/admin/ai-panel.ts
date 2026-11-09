// The weekly prompt panel shown in /admin "Prompt gaps": about 100 real buyer
// questions asked to four AI engines with web search
// (server/visibility/ai-panel.ts), read for GitDiagram, and every miss turned
// into one diagnosis and one fix.

export type PanelGroup = "situation" | "comparison" | "constraint" | "repo";

export const PANEL_GROUP_LABELS: Record<PanelGroup, string> = {
  situation: "Situation",
  comparison: "Comparison",
  constraint: "Constraint",
  repo: "Repo by name",
};

export type PanelEngine = "chatgpt" | "claude" | "gemini" | "perplexity";

export const PANEL_ENGINES: PanelEngine[] = [
  "chatgpt",
  "claude",
  "gemini",
  "perplexity",
];

export const PANEL_ENGINE_LABELS: Record<PanelEngine, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

export interface PanelAnswer {
  promptId: string;
  engine: PanelEngine;
  model: string;
  mentioned: boolean;
  /** GitDiagram's place among the tools named, from 1; null when not named. */
  position: number | null;
  /** gitdiagram.com URLs the answer cites. */
  ourUrls: string[];
  /** Every other URL the answer cites. */
  otherUrls: string[];
  /** gitdiagram.com was among the pages the engine's search returned. */
  inSources: boolean;
  /** Other tools named, in order. */
  competitors: string[];
  text: string;
  costUsd: number;
  error?: string;
  attempts: number;
}

/**
 * Why a prompt is a miss, decided in this order:
 * - weak page: an engine's search found gitdiagram.com but the answer did not name it.
 * - missing page: no gitdiagram.com page answers the question.
 * - third-party gap: our page exists; the engines answer from lists, forums and reviews we are not on.
 * - inaccessible page: our page exists but no engine's search retrieves it.
 */
export type GapDiagnosis =
  "weak page" | "missing page" | "third-party gap" | "inaccessible page";

export interface PromptGap {
  promptId: string;
  group: PanelGroup;
  text: string;
  /** Engines that answered without naming GitDiagram. */
  missedBy: PanelEngine[];
  /** Engines that named it. */
  namedBy: PanelEngine[];
  /** The page that should answer it, or null when none exists. */
  page: string | null;
  diagnosis: GapDiagnosis;
  fix: string;
  /** URLs the engines cited instead, most cited first. */
  citedInstead: Array<[url: string, engines: number]>;
  competitors: string[];
}

export interface PanelEngineStats {
  asked: number;
  answered: number;
  mentioned: number;
  cited: number;
  positionSum: number;
  costUsd: number;
}

export interface PanelReport {
  /** The Monday (UTC) the week's run belongs to. */
  week: string;
  startedAt: string;
  /** Null while questions are still being asked. */
  finishedAt: string | null;
  costUsd: number;
  prompts: number;
  models: Partial<Record<PanelEngine, string>>;
  engines: Record<PanelEngine, PanelEngineStats>;
  /** Prompts named by every engine that answered. */
  covered: number;
  gaps: PromptGap[];
  /** External URLs cited across all misses: the outreach list. */
  topCited: Array<[url: string, misses: number]>;
  /** External sites (hosts) cited across all misses. */
  topHosts: Array<[host: string, misses: number]>;
  competitors: Array<[name: string, answers: number]>;
}

export interface PanelWeek {
  week: string;
  costUsd: number;
  engines: Record<PanelEngine, PanelEngineStats>;
}

export interface PanelView {
  latest: PanelReport | null;
  /** Earlier weeks, newest first. */
  history: PanelWeek[];
}
