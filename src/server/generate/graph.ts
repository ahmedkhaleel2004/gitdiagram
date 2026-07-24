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

/**
 * A path only drives a node's "open on GitHub" link, so an unresolvable one is
 * cosmetic. Dropping it keeps an otherwise-correct graph instead of spending a
 * whole extra model call to regenerate the entire structure.
 */
export function stripUnknownNodePaths(
  graph: DiagramGraph,
  fileTreeLookup: Set<string>,
): { graph: DiagramGraph; strippedPathCount: number } {
  let strippedPathCount = 0;
  const nodes = graph.nodes.map((node) => {
    if (node.path && !fileTreeLookup.has(node.path)) {
      strippedPathCount += 1;
      return { ...node, path: null };
    }
    return node;
  });

  if (!strippedPathCount) {
    return { graph, strippedPathCount: 0 };
  }

  return { graph: { ...graph, nodes }, strippedPathCount };
}

export function isRepairableWithoutRetry(
  issues: GraphValidationIssue[],
): boolean {
  return (
    issues.length > 0 &&
    issues.every((issue) => issue.category === "missing_repository_path")
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

  return [primaryLabel, secondaryDetail, fileHint]
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

function toneClassForGroup(
  groupId: string | null | undefined,
  groupOrder: Map<string, number>,
): string {
  if (!groupId) {
    return "toneNeutral";
  }

  const index = groupOrder.get(groupId);
  if (index === undefined) {
    return "toneNeutral";
  }

  return toneClassNames[index % toneClassNames.length] ?? "toneNeutral";
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
    const className = toneClassForGroup(node.groupId, groupOrder);
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
