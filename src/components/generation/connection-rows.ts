import type { DiagramGraph } from "~/features/diagram/graph";

export interface ConnectionRow {
  key: string;
  from: string;
  to: string;
  label: string | null;
  /** The repository file where the relationship is visible, if cited. */
  evidencePath: string | null;
  dashed: boolean;
}

/** One row per diagram edge, in the diagram's own order. */
export function connectionRows(graph: DiagramGraph): ConnectionRow[] {
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  return graph.edges.map((edge, index) => ({
    key: `${index}:${edge.from}:${edge.to}`,
    from: labels.get(edge.from) ?? edge.from,
    to: labels.get(edge.to) ?? edge.to,
    label: edge.label,
    // Graphs stored before citations existed have no field at all.
    evidencePath: edge.evidencePath?.trim() || null,
    dashed: edge.style === "dashed",
  }));
}

/**
 * A GitHub link for a cited file. HEAD follows the default branch the diagram
 * was generated from; every segment is encoded, so a stored path can never
 * leave github.com or the repository.
 */
export function evidenceUrl(repository: string, path: string): string | null {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) return null;
  const encoded = path
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map(encodeURIComponent)
    .join("/");
  if (!encoded) return null;
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/HEAD/${encoded}`;
}
