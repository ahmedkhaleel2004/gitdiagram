import { architectureText } from "~/features/diagram/architecture-text";
import {
  normalizeDiagramText,
  type DiagramGraph,
} from "~/features/diagram/graph";
import type { DiagramStateResponse } from "~/features/diagram/types";

// A stored diagram as text: the explanation, its components grouped the way
// the diagram groups them, and the connections between them. Search engines
// and agents read this (the repository page's readout, its Markdown twin and
// its meta description); the Mermaid picture itself is drawn in the browser.

interface ReadoutComponent {
  id: string;
  label: string;
  type: string;
  description: string | null;
  path: string | null;
  /** The component's source on GitHub, when the diagram links one. */
  href: string | null;
}

interface ReadoutGroup {
  /** Null for the components the diagram leaves outside every group. */
  id: string | null;
  label: string;
  description: string | null;
  components: ReadoutComponent[];
}

interface ReadoutConnection {
  from: string;
  to: string;
  label: string | null;
  description: string | null;
  /** The repo file the arrow was read from, when the graph cites one. */
  evidencePath: string | null;
}

export interface DiagramReadout {
  /** The explanation in the notes' small Markdown subset (may be empty). */
  explanation: string;
  groups: ReadoutGroup[];
  connections: ReadoutConnection[];
  componentCount: number;
  lastSuccessfulAt: string | null;
}

export const UNGROUPED_LABEL = "Other components";

function cleanText(value: string | null | undefined): string | null {
  const text = value ? normalizeDiagramText(value) : "";
  return text || null;
}

/**
 * Each node's GitHub link, read back from the compiled Mermaid's `click`
 * lines (they carry the branch the diagram was made from). Only links into
 * this repository on github.com are kept.
 */
export function diagramSourceLinks(
  diagram: string,
  owner: string,
  repo: string,
): Map<string, string> {
  const prefix = `https://github.com/${owner}/${repo}/`.toLowerCase();
  const links = new Map<string, string>();
  for (const match of diagram.matchAll(
    /^\s*click\s+node_([a-z][a-z0-9_]*)\s+"(https:\/\/github\.com\/[^"\s]+)"/gm,
  )) {
    const [, id, url] = match;
    if (id && url && url.toLowerCase().startsWith(prefix)) links.set(id, url);
  }
  return links;
}

/** A path's GitHub URL on the default branch, when the diagram has none. */
function fallbackSourceLink(owner: string, repo: string, path: string) {
  const kind = path.includes(".") && !path.endsWith("/") ? "blob" : "tree";
  const encoded = path
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${kind}/HEAD/${encoded}`;
}

export function diagramReadout(
  state: DiagramStateResponse,
  owner: string,
  repo: string,
): DiagramReadout | null {
  if (!state.diagram) return null;
  const graph: DiagramGraph | null = state.graph;
  const explanation = state.explanation
    ? architectureText(state.explanation)
    : "";
  if (!graph) {
    return {
      explanation,
      groups: [],
      connections: [],
      componentCount: 0,
      lastSuccessfulAt: state.lastSuccessfulAt,
    };
  }

  const links = diagramSourceLinks(state.diagram, owner, repo);
  const labels = new Map<string, string>();
  const component = (node: DiagramGraph["nodes"][number]): ReadoutComponent => {
    const label = cleanText(node.label) ?? node.id;
    labels.set(node.id, label);
    const path = cleanText(node.path);
    return {
      id: node.id,
      label,
      type: cleanText(node.type) ?? "component",
      description: cleanText(node.description),
      path,
      href:
        links.get(node.id) ??
        (path ? fallbackSourceLink(owner, repo, path) : null),
    };
  };

  const known = new Set(graph.groups.map((group) => group.id));
  const groups: ReadoutGroup[] = graph.groups.map((group) => ({
    id: group.id,
    label: cleanText(group.label) ?? group.id,
    description: cleanText(group.description),
    components: graph.nodes
      .filter((node) => node.groupId === group.id)
      .map(component),
  }));
  const ungrouped = graph.nodes
    .filter((node) => !node.groupId || !known.has(node.groupId))
    .map(component);
  if (ungrouped.length) {
    groups.push({
      id: null,
      label: UNGROUPED_LABEL,
      description: null,
      components: ungrouped,
    });
  }

  const connections = graph.edges.flatMap((edge) => {
    const from = labels.get(edge.from);
    const to = labels.get(edge.to);
    return from && to
      ? [
          {
            from,
            to,
            label: cleanText(edge.label),
            description: cleanText(edge.description),
            evidencePath: edge.evidencePath ?? null,
          },
        ]
      : [];
  });

  return {
    explanation,
    groups: groups.filter((group) => group.components.length > 0),
    connections,
    componentCount: labels.size,
    lastSuccessfulAt: state.lastSuccessfulAt,
  };
}

/** Plain text of one line of the notes' Markdown subset. */
function plainLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first sentences of an explanation, as a meta description of at most
 * `max` characters. Headings are skipped; a first sentence that is too long
 * is cut at a word with an ellipsis. Null when there is no prose.
 */
export function explanationSummary(
  explanation: string,
  max = 160,
): string | null {
  const paragraph = explanation
    .split("\n")
    .filter((line) => line.trim() && !/^\s*#/.test(line))
    .map(plainLine)
    .find((line) => line.length > 30);
  if (!paragraph) return null;
  // "Node.js" and "v2.py" stay whole: a sentence ends at punctuation + space.
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  let summary = "";
  for (const sentence of sentences) {
    const next = `${summary} ${sentence}`.trim();
    if (next.length > max) break;
    summary = next;
  }
  if (summary) return summary;
  const cut = paragraph.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}
