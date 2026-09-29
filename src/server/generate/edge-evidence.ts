import type { DiagramGraph, DiagramGraphNode } from "~/features/diagram/graph";

/** What the model was actually shown, for checking the files it cites. */
export interface EdgeEvidenceContext {
  /** Every repository file read in full (excerpted or reference-only). */
  readPaths: readonly string[];
  /** For each file read, the repository files it imports or names. */
  references: Readonly<Record<string, readonly string[]>>;
}

const README = /^readme(?:\.[a-z0-9]+)?$/i;

function covers(nodePath: string, path: string): boolean {
  return path === nodePath || path.startsWith(`${nodePath}/`);
}

/**
 * A citation must be a file the model was shown: one GitDiagram read, or the
 * README it was given. A file known only by its name in the tree cannot show
 * a relationship, so citing it is dropped. So is a file that belongs to
 * neither side and does not reference both (the wiring file that constructs
 * both sides is kept). An edge left uncited is given the file that imports or
 * names the other side, when one of the files read does; this is the same
 * reference list the model saw in the source index.
 */
export function applyEdgeEvidence(
  graph: DiagramGraph,
  context: EdgeEvidenceContext,
  fileTreeLookup: ReadonlySet<string>,
): {
  graph: DiagramGraph;
  strippedEvidenceCount: number;
  filledEvidenceCount: number;
} {
  const seen = new Set(context.readPaths);
  const readmes = new Set<string>();
  for (const path of fileTreeLookup) if (README.test(path)) readmes.add(path);
  const relevant = (
    file: string,
    from?: DiagramGraphNode,
    to?: DiagramGraphNode,
  ) => {
    if (readmes.has(file)) return true;
    if (!seen.has(file)) return false;
    if ([from?.path, to?.path].some((path) => path && covers(path, file)))
      return true;
    const references = context.references[file] ?? [];
    return [from?.path, to?.path].every(
      (path) => path && references.some((reference) => covers(path, reference)),
    );
  };
  const nodes = new Map<string, DiagramGraphNode>(
    graph.nodes.map((node) => [node.id, node]),
  );
  const support = (from?: DiagramGraphNode, to?: DiagramGraphNode) => {
    if (!from?.path || !to?.path) return null;
    for (const [a, b] of [
      [from.path, to.path],
      [to.path, from.path],
    ] as const) {
      for (const file of context.readPaths) {
        if (!covers(a, file)) continue;
        // Two responsibilities of one file that was read.
        if (a === b) {
          if (file === a) return file;
          continue;
        }
        if (context.references[file]?.some((path) => covers(b, path)))
          return file;
      }
    }
    return null;
  };
  let strippedEvidenceCount = 0;
  let filledEvidenceCount = 0;
  const edges = graph.edges.map((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    let evidencePath = edge.evidencePath ?? null;
    if (evidencePath && !relevant(evidencePath, from, to)) {
      strippedEvidenceCount += 1;
      evidencePath = null;
    }
    if (!evidencePath) {
      evidencePath = support(from, to);
      if (evidencePath) filledEvidenceCount += 1;
    }
    return evidencePath === (edge.evidencePath ?? null)
      ? edge
      : { ...edge, evidencePath };
  });
  return {
    graph:
      strippedEvidenceCount || filledEvidenceCount
        ? { ...graph, edges }
        : graph,
    strippedEvidenceCount,
    filledEvidenceCount,
  };
}
