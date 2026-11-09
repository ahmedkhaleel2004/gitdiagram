// What a stored diagram shows, read from the names its components and groups
// carry. Shared by the 2026 architecture report (scripts/architecture-report)
// and the architecture hubs (features/architecture-hubs), so both count the
// same way. Each rule is a plain regular expression; the pages print them.

export const TRAITS = {
  llm: {
    label: "Has an LLM or AI-model component",
    rule: /\b(llms?|language models?|model providers?|ai providers?|llm providers?|openai|anthropic|ollama|gemini|inference (api|providers?|backends?))\b/,
  },
  mcp: {
    label: "Speaks MCP",
    rule: /\bmcp\b|model context protocol/,
  },
  cli: {
    label: "Has a command-line interface",
    rule: /\bcli\b|command[- ]line|\bterminal (ui|interface|app)\b|\btui\b/,
  },
  web: {
    label: "Has a web interface",
    rule: /\bweb (ui|app|application|interface|client|frontend|dashboard|console)\b|\bfrontend\b|\bdashboard\b/,
  },
  desktop: {
    label: "Has a desktop app",
    rule: /\bdesktop\b|\belectron\b|\btauri\b/,
  },
  plugins: {
    label: "Has a plugin or extension system",
    rule: /\bplugins?\b|\bextensions?\b|\badd-?ons?\b/,
  },
} as const;
export type Trait = keyof typeof TRAITS;
export const TRAIT_KEYS = Object.keys(TRAITS) as Trait[];

/** Folders that hold a workspace's packages, by convention. */
export const WORKSPACE_DIRS = [
  "packages",
  "apps",
  "crates",
  "libs",
  "services",
] as const;

/**
 * An outside actor (a circle) named as an AI agent or assistant. Model APIs
 * drawn as circles ("LLM provider") are services, not users, so "llm" is out.
 */
export const AGENT_ACTOR =
  /\bagents?\b|\bmcp clients?\b|\bassistants?\b|\bcopilot\b|\bclaude code\b|\bcodex\b/;

interface NamedGraph {
  nodes: ReadonlyArray<{ label: string; path?: string | null }>;
  groups: ReadonlyArray<{ label: string }>;
}

/** Text of every component and group name in a diagram, lowercased. */
export function graphNames(graph: NamedGraph): string {
  return [
    ...graph.nodes.map((node) => node.label),
    ...graph.groups.map((group) => group.label),
  ]
    .join(" | ")
    .toLowerCase();
}

/** Top-level folders the diagram's components link into. */
export function topFolders(graph: NamedGraph): Set<string> {
  const folders = new Set<string>();
  for (const node of graph.nodes) {
    const parts = node.path?.split("/") ?? [];
    if (parts.length > 1 && parts[0]) folders.add(parts[0]);
  }
  return folders;
}
