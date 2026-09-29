import type {
  DiagramGraph,
  DiagramGraphEdge,
  DiagramGraphNode,
} from "~/features/diagram/graph";
import {
  diagramGraphSchema,
  normalizeDiagramText,
} from "~/features/diagram/graph";
import type { RepositoryPathType } from "~/server/generate/github";

export interface GraphValidationIssue {
  category: GraphValidationCategory;
  path: string;
  message: string;
}

export type GraphValidationCategory =
  | "schema_validation"
  | "invalid_json"
  | "duplicate_group_id"
  | "duplicate_node_id"
  | "unknown_group_id"
  | "missing_repository_path"
  | "missing_evidence_path"
  | "unknown_edge_source"
  | "unknown_edge_target";

export interface GraphValidationResult {
  valid: boolean;
  issues: GraphValidationIssue[];
}

function buildIssue(
  category: GraphValidationCategory,
  path: string,
  message: string,
): GraphValidationIssue {
  return { category, path, message };
}

export function buildFileTreeLookup(fileTree: string): Set<string> {
  return new Set(
    fileTree
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function parseDiagramGraph(rawOutput: string): {
  graph: DiagramGraph | null;
  issues: GraphValidationIssue[];
} {
  try {
    const parsed = JSON.parse(rawOutput) as unknown;
    const result = diagramGraphSchema.safeParse(parsed);
    if (!result.success) {
      return {
        graph: null,
        issues: result.error.issues.map((issue) =>
          buildIssue(
            "schema_validation",
            issue.path.join(".") || "graph",
            issue.message,
          ),
        ),
      };
    }

    return {
      graph: result.data,
      issues: [],
    };
  } catch (error) {
    return {
      graph: null,
      issues: [
        buildIssue(
          "invalid_json",
          "graph",
          error instanceof Error
            ? error.message
            : "Graph output was not valid JSON.",
        ),
      ],
    };
  }
}

export function validateDiagramGraph(
  graph: DiagramGraph,
  fileTreeLookup: Set<string>,
): GraphValidationResult {
  const issues: GraphValidationIssue[] = [];
  const groupIds = new Set<string>();
  const nodeIds = new Set<string>();

  graph.groups.forEach((group, index) => {
    if (groupIds.has(group.id)) {
      issues.push(
        buildIssue(
          "duplicate_group_id",
          `groups.${index}.id`,
          `Duplicate group id "${group.id}".`,
        ),
      );
    }
    groupIds.add(group.id);
  });

  graph.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      issues.push(
        buildIssue(
          "duplicate_node_id",
          `nodes.${index}.id`,
          `Duplicate node id "${node.id}".`,
        ),
      );
    }
    nodeIds.add(node.id);

    if (node.groupId && !groupIds.has(node.groupId)) {
      issues.push(
        buildIssue(
          "unknown_group_id",
          `nodes.${index}.groupId`,
          `Unknown group id "${node.groupId}" for node "${node.id}".`,
        ),
      );
    }

    if (node.path && !fileTreeLookup.has(node.path)) {
      issues.push(
        buildIssue(
          "missing_repository_path",
          `nodes.${index}.path`,
          `Path "${node.path}" does not exist in the repository file tree.`,
        ),
      );
    }
  });

  graph.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) {
      issues.push(
        buildIssue(
          "unknown_edge_source",
          `edges.${index}.from`,
          `Unknown source node id "${edge.from}".`,
        ),
      );
    }
    if (!nodeIds.has(edge.to)) {
      issues.push(
        buildIssue(
          "unknown_edge_target",
          `edges.${index}.to`,
          `Unknown target node id "${edge.to}".`,
        ),
      );
    }
    if (edge.evidencePath && !fileTreeLookup.has(edge.evidencePath)) {
      issues.push(
        buildIssue(
          "missing_evidence_path",
          `edges.${index}.evidencePath`,
          `Evidence path "${edge.evidencePath}" does not exist in the repository file tree.`,
        ),
      );
    }
  });

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function formatGraphValidationFeedback(
  issues: GraphValidationIssue[],
): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
}

const REPAIRABLE_PATH_CATEGORIES = new Set<GraphValidationCategory>([
  "missing_repository_path",
  "missing_evidence_path",
]);

/**
 * A node path only drives its "open on GitHub" link and an edge's evidence
 * path only its citation, so an unresolvable one is cosmetic. Dropping it keeps
 * an otherwise-correct graph instead of spending a whole extra model call to
 * regenerate the entire structure. An edge whose citation is dropped is shown
 * as unproven in the connections list.
 */
export function stripUnknownGraphPaths(
  graph: DiagramGraph,
  fileTreeLookup: Set<string>,
): {
  graph: DiagramGraph;
  strippedPathCount: number;
  strippedEvidenceCount: number;
} {
  let strippedPathCount = 0;
  let strippedEvidenceCount = 0;
  const nodes = graph.nodes.map((node) => {
    if (node.path && !fileTreeLookup.has(node.path)) {
      strippedPathCount += 1;
      return { ...node, path: null };
    }
    return node;
  });
  const edges = graph.edges.map((edge) => {
    if (edge.evidencePath && !fileTreeLookup.has(edge.evidencePath)) {
      strippedEvidenceCount += 1;
      return { ...edge, evidencePath: null };
    }
    return edge;
  });

  if (!strippedPathCount && !strippedEvidenceCount) {
    return { graph, strippedPathCount: 0, strippedEvidenceCount: 0 };
  }

  return {
    graph: { ...graph, nodes, edges },
    strippedPathCount,
    strippedEvidenceCount,
  };
}

export function isRepairableWithoutRetry(
  issues: GraphValidationIssue[],
): boolean {
  return (
    issues.length > 0 &&
    issues.every((issue) => REPAIRABLE_PATH_CATEGORIES.has(issue.category))
  );
}

function escapeMermaidText(value: string): string {
  const escaped = normalizeDiagramText(value)
    .replace(/&/g, "&amp;")
    // Mermaid decodes its own '#nn;' entity codes inside label text, so an
    // unescaped '#' would reintroduce characters the rules below just removed.
    .replace(/#/g, "&#35;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // A label that opens with a backtick turns the whole quoted string into a
    // Mermaid markdown string, which fails to lex and takes the entire diagram
    // down. Nothing downstream parses Mermaid on the server, so an unescaped
    // backtick would be persisted and break the artifact for every later reader.
    .replace(/`/g, "&#96;")
    .replace(/\\/g, "&#92;")
    .replace(/\|/g, "&#124;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/\(/g, "&#40;")
    .replace(/\)/g, "&#41;")
    .trim();

  return escaped || "Unnamed";
}

const genericNodeTypes = new Set([
  "app",
  "application",
  "component",
  "directory",
  "folder",
  "library",
  "module",
  "package",
  "project",
  "repo",
  "repository",
  "service",
  "system",
  "utility",
]);
const MAX_NODE_FILE_HINT_LENGTH = 18;

function detailForNode(node: DiagramGraphNode): string | null {
  const type = node.type.trim();
  if (!type) {
    return null;
  }

  const normalizedType = type.toLowerCase();
  const normalizedLabel = node.label.trim().toLowerCase();
  if (
    genericNodeTypes.has(normalizedType) ||
    normalizedType === normalizedLabel ||
    normalizedType.includes(normalizedLabel) ||
    normalizedLabel.includes(normalizedType) ||
    type.split(/\s+/).length > 4
  ) {
    return null;
  }

  return escapeMermaidText(type);
}

function fileHintForNode(node: DiagramGraphNode): string | null {
  const path = node.path?.trim();
  if (!path || path.endsWith("/") || !path.includes(".")) {
    return null;
  }

  const fileName = path.split("/").pop()?.trim();
  if (!fileName || fileName.length > MAX_NODE_FILE_HINT_LENGTH) {
    return null;
  }

  return `[${escapeMermaidText(fileName)}]`;
}

function labelForNode(node: DiagramGraphNode): string {
  const primaryLabel = escapeMermaidText(node.label);
  const secondaryDetail = detailForNode(node);
  const fileHint = fileHintForNode(node);

  return [primaryLabel, secondaryDetail ?? fileHint]
    .filter(Boolean)
    .join("<br/>");
}

function mermaidNodeId(nodeId: string): string {
  return `node_${nodeId}`;
}

function mermaidGroupId(groupId: string): string {
  return `group_${groupId}`;
}

function renderNode(node: DiagramGraphNode): string {
  const label = labelForNode(node);
  const shape = node.shape ?? "box";
  const nodeId = mermaidNodeId(node.id);

  switch (shape) {
    case "database":
      return `${nodeId}[("${label}")]`;
    case "circle":
      return `${nodeId}(("${label}"))`;
    case "hexagon":
      return `${nodeId}{{"${label}"}}`;
    case "queue":
    case "document":
    case "box":
    default:
      return `${nodeId}["${label}"]`;
  }
}

function renderEdge(edge: DiagramGraphEdge): string {
  const connector = edge.style === "dashed" ? "-.->" : "-->";
  const from = mermaidNodeId(edge.from);
  const to = mermaidNodeId(edge.to);
  if (!edge.label) {
    return `${from} ${connector} ${to}`;
  }

  return `${from} ${connector}|"${escapeMermaidText(edge.label)}"| ${to}`;
}

const toneClassNames = [
  "toneBlue",
  "toneAmber",
  "toneMint",
  "toneRose",
  "toneIndigo",
  "toneTeal",
] as const;

function toneClassForNode(
  node: DiagramGraphNode,
  groupOrder: Map<string, number>,
): string {
  const groupIndex = node.groupId ? groupOrder.get(node.groupId) : undefined;
  if (groupIndex !== undefined)
    return toneClassNames[groupIndex % toneClassNames.length]!;
  // Meaningful colour is a compiler guarantee, even when the planner needs no
  // groups. Existing grouped diagrams retain their familiar subsystem palette.
  const words = `${node.label} ${node.type}`.toLowerCase();
  if (
    node.shape === "database" ||
    /database|storage|cache|postgres|sqlite|redis|clickhouse/.test(words)
  )
    return "toneAmber";
  if (/queue|worker|background|scheduler|task/.test(words)) return "toneRose";
  if (/client|browser|user|frontend|view|screen|ui\b/.test(words))
    return "toneBlue";
  if (/api|server|route|request|handler|webhook/.test(words)) return "toneMint";
  if (!node.path || /model|inference|provider|integration/.test(words))
    return "toneIndigo";
  return "toneTeal";
}

/** Repair formatting only when the canonical path is known to exist. */
export function normalizeKnownGraphPaths(
  graph: DiagramGraph,
  paths: Set<string>,
): DiagramGraph {
  const canonical = (path: string) => {
    if (paths.has(path)) return path;
    const repaired = path.replace(/^\.\//, "").replace(/\/+$/, "");
    return paths.has(repaired) ? repaired : path;
  };
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.path && !paths.has(node.path)
        ? { ...node, path: canonical(node.path) }
        : node,
    ),
    edges: graph.edges.map((edge) => {
      if (edge.evidencePath === undefined) return edge;
      // An empty citation means none, like a null one.
      const evidencePath = edge.evidencePath?.trim()
        ? canonical(edge.evidencePath.trim())
        : null;
      return evidencePath === edge.evidencePath
        ? edge
        : { ...edge, evidencePath };
    }),
  };
}

function buildGitHubUrl(
  path: string,
  username: string,
  repo: string,
  branch: string,
  pathType?: RepositoryPathType,
): string {
  const githubPathType =
    pathType ?? (path.includes(".") && !path.endsWith("/") ? "blob" : "tree");
  const encodePath = (value: string) =>
    value.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/${githubPathType}/${encodePath(branch)}/${encodePath(path)}`;
}

export function compileDiagramGraph(params: {
  graph: DiagramGraph;
  username: string;
  repo: string;
  branch: string;
  pathTypes?: ReadonlyMap<string, RepositoryPathType>;
}): string {
  const { graph, username, repo, branch, pathTypes } = params;
  const lines: string[] = ["flowchart TD"];
  const groupedNodeIds = new Set<string>();
  const classAssignments = new Map<string, string[]>();
  const groupOrder = new Map(
    graph.groups.map((group, index) => [group.id, index]),
  );

  const pushNode = (node: DiagramGraphNode, indent = "") => {
    lines.push(`${indent}${renderNode(node)}`);
    const className = toneClassForNode(node, groupOrder);
    classAssignments.set(className, [
      ...(classAssignments.get(className) ?? []),
      node.id,
    ]);
  };

  for (const group of graph.groups) {
    lines.push("");
    lines.push(
      `subgraph ${mermaidGroupId(group.id)}["${escapeMermaidText(group.label)}"]`,
    );
    for (const node of graph.nodes.filter(
      (candidate) => candidate.groupId === group.id,
    )) {
      pushNode(node, "  ");
      groupedNodeIds.add(node.id);
    }
    lines.push("end");
  }

  const ungroupedNodes = graph.nodes.filter(
    (node) => !groupedNodeIds.has(node.id),
  );
  if (ungroupedNodes.length) {
    lines.push("");
    for (const node of ungroupedNodes) {
      pushNode(node);
    }
  }

  if (graph.edges.length) {
    lines.push("");
    for (const edge of graph.edges) {
      lines.push(renderEdge(edge));
    }
  }

  const nodesWithPaths = graph.nodes.filter((node) => node.path);
  if (nodesWithPaths.length) {
    lines.push("");
    for (const node of nodesWithPaths) {
      lines.push(
        `click ${mermaidNodeId(node.id)} "${buildGitHubUrl(node.path!, username, repo, branch, pathTypes?.get(node.path!))}"`,
      );
    }
  }

  lines.push("");
  lines.push(
    "classDef toneNeutral fill:#f8fafc,stroke:#334155,stroke-width:1.5px,color:#0f172a",
  );
  lines.push(
    "classDef toneBlue fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#172554",
  );
  lines.push(
    "classDef toneAmber fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f",
  );
  lines.push(
    "classDef toneMint fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d",
  );
  lines.push(
    "classDef toneRose fill:#ffe4e6,stroke:#e11d48,stroke-width:1.5px,color:#881337",
  );
  lines.push(
    "classDef toneIndigo fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81",
  );
  lines.push(
    "classDef toneTeal fill:#ccfbf1,stroke:#0f766e,stroke-width:1.5px,color:#134e4a",
  );

  for (const [className, nodeIds] of classAssignments) {
    if (!nodeIds.length) continue;
    lines.push(`class ${nodeIds.map(mermaidNodeId).join(",")} ${className}`);
  }

  return lines.join("\n").trim();
}
