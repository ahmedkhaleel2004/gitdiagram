const explicitSubgraphPattern =
  /^(\s*)subgraph\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s*\["((?:\\.|[^"\\])*)"\])?\s*$/u;
const quotedSubgraphPattern = /^(\s*)subgraph\s+"((?:\\.|[^"\\])*)"\s*$/u;
const nodeDeclarationPattern =
  /^(\s*)([A-Za-z_][A-Za-z0-9_-]*)(?=\s*(?:\[|\(|\{|>))/u;
const modernNodeIdPattern = /^node_[a-z][a-z0-9_]*$/u;
const modernGroupIdPattern = /^group_[a-z][a-z0-9_]*$/u;

interface SubgraphDeclaration {
  indent: string;
  label: string;
  newId: string;
  oldId: string | null;
}

export interface MermaidModernizationResult {
  source: string;
  changed: boolean;
  nodeRenames: Record<string, string>;
  groupRenames: Record<string, string>;
  nodeCount: number;
  groupCount: number;
  clickCount: number;
}

function toSnakeCase(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();

  if (!normalized) {
    throw new Error(
      `Cannot derive a Mermaid identifier from ${JSON.stringify(value)}.`,
    );
  }

  return /^[a-z]/u.test(normalized) ? normalized : `id_${normalized}`;
}

function modernNodeId(value: string): string {
  return modernNodeIdPattern.test(value) ? value : `node_${toSnakeCase(value)}`;
}

function modernGroupId(value: string): string {
  return modernGroupIdPattern.test(value)
    ? value
    : `group_${toSnakeCase(value)}`;
}

function reserveUniqueId(base: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }

  let suffix = 2;
  while (usedIds.has(`${base}_${suffix}`)) {
    suffix += 1;
  }

  const uniqueId = `${base}_${suffix}`;
  usedIds.add(uniqueId);
  return uniqueId;
}

function replaceKnownIdentifiers(
  line: string,
  replacements: ReadonlyMap<string, string>,
): string {
  let result = "";
  let index = 0;
  let inDoubleQuote = false;
  let inPipeLabel = false;
  let squareDepth = 0;
  let roundDepth = 0;
  let curlyDepth = 0;

  while (index < line.length) {
    const character = line[index] ?? "";
    const previous = index > 0 ? line[index - 1] : "";

    if (character === '"' && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      result += character;
      index += 1;
      continue;
    }

    if (!inDoubleQuote) {
      if (
        character === "|" &&
        squareDepth === 0 &&
        roundDepth === 0 &&
        curlyDepth === 0
      ) {
        inPipeLabel = !inPipeLabel;
      } else if (!inPipeLabel) {
        if (character === "[") squareDepth += 1;
        if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
        if (character === "(") roundDepth += 1;
        if (character === ")") roundDepth = Math.max(0, roundDepth - 1);
        if (character === "{") curlyDepth += 1;
        if (character === "}") curlyDepth = Math.max(0, curlyDepth - 1);
      }
    }

    const canReplace =
      !inDoubleQuote &&
      !inPipeLabel &&
      squareDepth === 0 &&
      roundDepth === 0 &&
      curlyDepth === 0 &&
      /[A-Za-z_]/u.test(character);

    if (!canReplace) {
      result += character;
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < line.length && /[A-Za-z0-9_-]/u.test(line[end] ?? "")) {
      end += 1;
    }

    const token = line.slice(index, end);
    result += replacements.get(token) ?? token;
    index = end;
  }

  return result;
}

export function modernizeLegacyMermaidSource(
  source: string,
): MermaidModernizationResult {
  const lines: string[] = [];
  let insideConfigDirective = false;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (insideConfigDirective) {
      insideConfigDirective = !trimmed.includes("}%%");
      continue;
    }
    if (trimmed.startsWith("%%{")) {
      insideConfigDirective = !trimmed.includes("}%%");
      continue;
    }
    if (!lines.length && !trimmed) {
      continue;
    }
    lines.push(line);
  }
  const nodeRenames = new Map<string, string>();
  const groupRenames = new Map<string, string>();
  const subgraphs = new Map<number, SubgraphDeclaration>();
  const usedNodeIds = new Set<string>();
  const usedGroupIds = new Set<string>();

  for (const [lineIndex, line] of lines.entries()) {
    const explicitSubgraph = line.match(explicitSubgraphPattern);
    if (explicitSubgraph) {
      const [, indent = "", oldId = "", explicitLabel] = explicitSubgraph;
      const newId = modernGroupId(oldId);
      const existing = groupRenames.get(oldId);
      if (existing && existing !== newId) {
        throw new Error(`Conflicting Mermaid subgraph identifier ${oldId}.`);
      }
      if (usedGroupIds.has(newId) && existing !== newId) {
        throw new Error(`Mermaid subgraph identifiers collide at ${newId}.`);
      }
      usedGroupIds.add(newId);
      groupRenames.set(oldId, newId);
      subgraphs.set(lineIndex, {
        indent,
        label: explicitLabel ?? oldId,
        newId,
        oldId,
      });
      continue;
    }

    const quotedSubgraph = line.match(quotedSubgraphPattern);
    if (quotedSubgraph) {
      const [, indent = "", label = ""] = quotedSubgraph;
      subgraphs.set(lineIndex, {
        indent,
        label,
        newId: reserveUniqueId(modernGroupId(label), usedGroupIds),
        oldId: null,
      });
      continue;
    }

    if (line.trimStart().startsWith("%%")) {
      continue;
    }

    const declaration = line.match(nodeDeclarationPattern);
    if (!declaration) {
      continue;
    }

    const oldId = declaration[2] ?? "";
    const newId = modernNodeId(oldId);
    const existing = nodeRenames.get(oldId);
    if (existing && existing !== newId) {
      throw new Error(`Conflicting Mermaid node identifier ${oldId}.`);
    }
    if (usedNodeIds.has(newId) && existing !== newId) {
      throw new Error(`Mermaid node identifiers collide at ${newId}.`);
    }
    usedNodeIds.add(newId);
    nodeRenames.set(oldId, newId);
  }

  for (const [oldId, newId] of groupRenames) {
    const nodeReplacement = nodeRenames.get(oldId);
    if (nodeReplacement && nodeReplacement !== newId) {
      throw new Error(
        `Mermaid identifier ${oldId} is used by both a node and a subgraph.`,
      );
    }
  }

  const replacements = new Map([...groupRenames, ...nodeRenames]);
  const modernizedLines = lines.map((line, lineIndex) => {
    const subgraph = subgraphs.get(lineIndex);
    if (subgraph) {
      return `${subgraph.indent}subgraph ${subgraph.newId}["${subgraph.label}"]`;
    }

    if (line.trimStart().startsWith("%%")) {
      return line;
    }

    const normalizedHeader = line.replace(/^(\s*)graph\b/u, "$1flowchart");
    return replaceKnownIdentifiers(normalizedHeader, replacements);
  });

  const modernizedSource = modernizedLines.join("\n");
  const clickCount = modernizedLines.filter((line) =>
    /^\s*click\s+node_[a-z][a-z0-9_]*\s+"https:\/\/github\.com\/[^"\s]+"\s*$/u.test(
      line,
    ),
  ).length;

  return {
    source: modernizedSource,
    changed: modernizedSource !== source,
    nodeRenames: Object.fromEntries(nodeRenames),
    groupRenames: Object.fromEntries(groupRenames),
    nodeCount: nodeRenames.size,
    groupCount: subgraphs.size,
    clickCount,
  };
}
