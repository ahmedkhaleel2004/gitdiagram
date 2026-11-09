import { storedExplanationText } from "~/features/diagram/legacy-explanation";
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

/** A file to start reading the code at (a component with a linked path). */
interface ReadoutEntryPoint {
  label: string;
  path: string;
  href: string;
}

export interface DiagramReadout {
  /** The explanation in the notes' small Markdown subset (may be empty). */
  explanation: string;
  /** The most connected components that name a file, most connected first. */
  entryPoints: ReadoutEntryPoint[];
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
    ? storedExplanationText(state.explanation)
    : "";
  if (!graph) {
    return {
      explanation,
      entryPoints: [],
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
    entryPoints: entryPoints(graph, groups),
    groups: groups.filter((group) => group.components.length > 0),
    connections,
    componentCount: labels.size,
    lastSuccessfulAt: state.lastSuccessfulAt,
  };
}

const ENTRY_POINT_COUNT = 4;

/**
 * The components the diagram's arrows run through most (an arrow out counts
 * a little more than one in), among those that link a file in the repo.
 */
function entryPoints(
  graph: DiagramGraph,
  groups: ReadoutGroup[],
): ReadoutEntryPoint[] {
  const weight = new Map<string, number>();
  for (const edge of graph.edges) {
    weight.set(edge.from, (weight.get(edge.from) ?? 0) + 1.2);
    weight.set(edge.to, (weight.get(edge.to) ?? 0) + 1);
  }
  const seen = new Set<string>();
  return groups
    .flatMap((group) => group.components)
    .filter(
      (
        component,
      ): component is ReadoutComponent & {
        path: string;
        href: string;
      } => Boolean(component.path && component.href),
    )
    .map((component, order) => ({ component, order }))
    .sort(
      (left, right) =>
        (weight.get(right.component.id) ?? 0) -
          (weight.get(left.component.id) ?? 0) || left.order - right.order,
    )
    .filter(({ component }) => {
      if (seen.has(component.path)) return false;
      seen.add(component.path);
      return (weight.get(component.id) ?? 0) > 0;
    })
    .slice(0, ENTRY_POINT_COUNT)
    .map(({ component }) => ({
      label: component.label,
      path: component.path,
      href: component.href,
    }));
}

/**
 * How an entry point's file is shown: its name, or its last two parts when
 * another entry point has a file of the same name.
 */
export function entryPointNames(paths: readonly string[]): string[] {
  const parts = paths.map((path) =>
    path.replace(/^\.\//, "").replace(/\/+$/, "").split("/"),
  );
  const base = parts.map((part) => part[part.length - 1] ?? "");
  return parts.map((part, index) =>
    base.filter((name) => name === base[index]).length > 1
      ? part.slice(-2).join("/")
      : (base[index] ?? ""),
  );
}

/** Plain text of one line of the notes' Markdown subset. */
/** A line that names something instead of saying something. */
function isLabelLine(line: string): boolean {
  const trimmed = line.trim().replace(/^[-*]\s+/, "");
  const words = plainLine(trimmed).split(" ").filter(Boolean);
  return (
    words.length < 6 ||
    /^\*\*[^*]+\*\*:?$/.test(trimmed) ||
    /^\[[^\]]+\]:?$/.test(trimmed) ||
    (/:$/.test(trimmed) && words.length < 10)
  );
}

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
 * is cut at a word with an ellipsis. Null when there is no prose, or when
 * the first line is a label rather than a sentence (fewer than six words,
 * all bold, in brackets, or a short line ending in a colon), as in old diagrams' cleaned
 * notes ("**Frontend (SvelteKit Application)**"): the page then uses its
 * plain description instead.
 */
export function explanationSummary(
  explanation: string,
  max = 160,
): string | null {
  const first = explanation
    .split("\n")
    .filter((line) => line.trim() && !/^\s*#/.test(line))
    .find((line) => plainLine(line).length > 30);
  if (!first || isLabelLine(first)) return null;
  // "…rather than one integrated application:" ends a sentence here.
  const paragraph = plainLine(first).replace(/:$/, ".");
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
