// What the /admin "Search & AI" panel shows: how often AI assistants name
// GitDiagram (a daily run of fixed questions, server/visibility/ai-visibility.ts)
// and which crawlers and AI agents fetch the site (server/visibility/agent-fetch.ts).

export type AiProvider = "openai" | "anthropic";
/** "search": the model may search the web; "memory": it answers from training alone. */
export type AiMode = "search" | "memory";
export type AiVariant = `${AiProvider}:${AiMode}`;

export const AI_VARIANTS: AiVariant[] = [
  "openai:search",
  "openai:memory",
  "anthropic:search",
  "anthropic:memory",
];

export const AI_VARIANT_LABELS: Record<AiVariant, string> = {
  "openai:search": "ChatGPT · search",
  "openai:memory": "ChatGPT · memory",
  "anthropic:search": "Claude · search",
  "anthropic:memory": "Claude · memory",
};

export interface AiVariantStats {
  /** Questions asked, and how many came back with an answer. */
  asked: number;
  answered: number;
  /** Answers naming GitDiagram, and those linking to gitdiagram.com. */
  mentioned: number;
  cited: number;
  /** Sum of GitDiagram's place among the tools named, over the answers naming it. */
  positionSum: number;
}

/** One day's run, small enough to keep half a year of. */
export interface AiVisibilitySummary {
  date: string;
  ranAt: string;
  durationMs: number;
  costUsd: number;
  models: Record<AiProvider, string>;
  /** Prompt ids, in the order `marks` uses. */
  prompts: string[];
  variants: Record<AiVariant, AiVariantStats>;
  /** One character per prompt: "2" cited, "1" named, "0" not named, "-" failed. */
  marks: Record<AiVariant, string>;
  /** Other tools, by how many answers named them. */
  competitors: Array<[string, number]>;
}

export interface AiAnswer {
  variant: AiVariant;
  promptId: string;
  prompt: string;
  mentioned: boolean;
  cited: boolean;
  /** gitdiagram.com was among the pages the search returned. */
  inSources: boolean;
  /** GitDiagram's place among the tools named, from 1; null when not named. */
  position: number | null;
  tools: string[];
  text: string;
  citations: string[];
  costUsd: number;
  error?: string;
}

export interface AiVisibilityDetail {
  date: string;
  answers: AiAnswer[];
}

export interface AgentFetchDay {
  date: string;
  /** Fetches by bot family. */
  families: Record<string, number>;
  /** Fetches by `family@surface`. */
  surfaces: Record<string, number>;
}

export interface VisibilityReport {
  /** Newest first. */
  summaries: AiVisibilitySummary[];
  latest: AiVisibilityDetail | null;
  /** Newest first; null when Redis could not be read. */
  agents: AgentFetchDay[] | null;
}

/** Bot families that are AI crawlers or assistants, not search engines or link previews. */
export const AI_AGENT_FAMILIES: ReadonlySet<string> = new Set([
  "ChatGPT-User",
  "OAI-SearchBot",
  "GPTBot",
  "Claude-User",
  "Claude-SearchBot",
  "ClaudeBot",
  "Perplexity-User",
  "PerplexityBot",
  "MistralAI-User",
  "DuckAssistBot",
  "Gemini",
  "GoogleOther",
  "meta-externalagent",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "YouBot",
]);

/** A share as a whole percent, "–" when nothing was asked. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}
