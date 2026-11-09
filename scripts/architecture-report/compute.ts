/**
 * Step 2 of the architecture report (/open-source-architecture-2026).
 * Works offline on the folder fetch.ts filled; touches no service.
 *
 *   bun run report:compute --in <cache-dir> [--sample 1000]
 *
 * Writes the page's numbers to src/features/architecture-report/data.json (run
 * `bun run format:write` after) and the downloadable per-repository dataset
 * to public/reports/. Every number is
 * a count over stored GitDiagram diagrams of public repositories; the matching
 * rules below are the whole method, so the page can state them exactly.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { DiagramGraph } from "../../src/features/diagram/graph";

function flag(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const inDir = path.resolve(flag("in"));
const sampleSize = Number(flag("sample", "1000"));
// Run from the repository root.
const repoRoot = process.cwd();
const SLUG = "open-source-architecture-2026";

interface Stored {
  username: string;
  repo: string;
  graph: DiagramGraph | null;
  generatedAt: string;
  lastSuccessfulAt: string;
}
interface GitHubMeta {
  nameWithOwner: string;
  stargazerCount: number;
  isArchived: boolean;
  isFork: boolean;
  createdAt: string;
  primaryLanguage: { name: string } | null;
}

const github: Record<string, GitHubMeta | null> = JSON.parse(
  await readFile(path.join(inDir, "github.json"), "utf8"),
);
const indexSummary = JSON.parse(
  await readFile(path.join(inDir, "index-summary.json"), "utf8"),
) as { readAt: string; indexEntries: number; candidates: unknown[] };

const all: Array<Stored & { meta: GitHubMeta; graph: DiagramGraph }> = [];
let withoutGraph = 0;
let unavailable = 0;
let forks = 0;
for (const file of await readdir(path.join(inDir, "artifacts"))) {
  const stored = JSON.parse(
    await readFile(path.join(inDir, "artifacts", file), "utf8"),
  ) as Stored | null;
  if (!stored) continue;
  if (!stored.graph || stored.graph.nodes.length === 0) {
    withoutGraph += 1;
    continue;
  }
  const meta = github[`${stored.username}/${stored.repo}`];
  if (!meta) {
    unavailable += 1;
    continue;
  }
  if (meta.isFork) {
    forks += 1;
    continue;
  }
  all.push({ ...stored, graph: stored.graph, meta });
}
// A renamed repository can be stored under its old and new name; GitHub
// answers both with the same canonical name. Keep the copy stored under it.
const canonical = new Map<string, (typeof all)[number]>();
for (const item of all) {
  const key = item.meta.nameWithOwner.toLowerCase();
  const current = canonical.get(key);
  const isCanonical = `${item.username}/${item.repo}` === key;
  if (!current || isCanonical) canonical.set(key, item);
}
const duplicates = all.length - canonical.size;
all.splice(0, all.length, ...canonical.values());
all.sort(
  (a, b) =>
    b.meta.stargazerCount - a.meta.stargazerCount ||
    a.meta.nameWithOwner.localeCompare(b.meta.nameWithOwner),
);
const sample = all.slice(0, sampleSize);
if (sample.length < sampleSize) {
  throw new Error(`Only ${sample.length} usable diagrams.`);
}

// ---- What each repository's diagram shows -------------------------------

/** Text of every component and group name in a diagram, lowercased. */
function names(graph: DiagramGraph): string {
  return [
    ...graph.nodes.map((node) => node.label),
    ...graph.groups.map((group) => group.label),
  ]
    .join(" | ")
    .toLowerCase();
}

/**
 * Traits read from component and group names. Each rule is a plain regular
 * expression over the names the diagram gives its parts; the page lists them.
 */
const TRAITS = {
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
type Trait = keyof typeof TRAITS;
const TRAIT_KEYS = Object.keys(TRAITS) as Trait[];

/** Folders that hold a workspace's packages, by convention. */
const WORKSPACE_DIRS = ["packages", "apps", "crates", "libs", "services"];
/**
 * An outside actor (a circle) named as an AI agent or assistant. Model APIs
 * drawn as circles ("LLM provider") are services, not users, so "llm" is out.
 */
const AGENT_ACTOR =
  /\bagents?\b|\bmcp clients?\b|\bassistants?\b|\bcopilot\b|\bclaude code\b|\bcodex\b/;

function topFolders(graph: DiagramGraph): Set<string> {
  const folders = new Set<string>();
  for (const node of graph.nodes) {
    const parts = node.path?.split("/") ?? [];
    if (parts.length > 1 && parts[0]) folders.add(parts[0]);
  }
  return folders;
}

const rows = sample.map((item, position) => {
  const { graph } = item;
  const text = names(graph);
  const traits = Object.fromEntries(
    TRAIT_KEYS.map((key) => [key, TRAITS[key].rule.test(text)]),
  ) as Record<Trait, boolean>;
  const folders = topFolders(graph);
  const actors = graph.nodes.filter((node) => node.shape === "circle");
  const withEvidenceField = graph.edges.some((edge) => "evidencePath" in edge);
  return {
    rank: position + 1,
    repository: item.meta.nameWithOwner,
    url: `https://gitdiagram.com/${item.username}/${item.repo}`,
    stars: item.meta.stargazerCount,
    language: item.meta.primaryLanguage?.name ?? null,
    createdYear: Number(item.meta.createdAt.slice(0, 4)),
    archived: item.meta.isArchived,
    components: graph.nodes.length,
    connections: graph.edges.length,
    groups: graph.groups.length,
    linkedComponents: graph.nodes.filter((node) => node.path).length,
    storage: graph.nodes.some((node) => node.shape === "database"),
    queue: graph.nodes.some((node) => node.shape === "queue"),
    outsideActor: actors.length > 0,
    agentActor: actors.some((node) =>
      AGENT_ACTOR.test(node.label.toLowerCase()),
    ),
    workspace: WORKSPACE_DIRS.filter((dir) => folders.has(dir)),
    ...traits,
    citedConnections: withEvidenceField
      ? graph.edges.filter((edge) => edge.evidencePath).length
      : null,
    linkedFiles: graph.nodes
      .map((node) => node.path)
      .filter((p): p is string => Boolean(p)),
    groupNames: graph.groups.map((group) => group.label),
    diagramDate: item.lastSuccessfulAt.slice(0, 10),
  };
});
type Row = (typeof rows)[number];

// ---- Aggregates ----------------------------------------------------------

const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0;
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function quartiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))]!;
  return { p25: at(0.25), median: median(values), p75: at(0.75) };
}
function examples(list: Row[], count = 4) {
  return list.slice(0, count).map((row) => ({
    repository: row.repository,
    url: row.url,
    stars: row.stars,
  }));
}

const languages = new Map<string, Row[]>();
for (const row of rows) {
  const key = row.language ?? "No primary language";
  languages.set(key, [...(languages.get(key) ?? []), row]);
}
const MIN_LANGUAGE = 40;
const majorLanguages = [...languages.entries()]
  .filter(
    ([name, list]) =>
      list.length >= MIN_LANGUAGE && name !== "No primary language",
  )
  .sort((a, b) => b[1].length - a[1].length);

const traitTotals = TRAIT_KEYS.map((key) => {
  const matching = rows.filter((row) => row[key]);
  return {
    key,
    label: TRAITS[key].label,
    count: matching.length,
    share: pct(matching.length, rows.length),
    rule: TRAITS[key].rule.source,
    examples: examples(matching),
  };
});

const byLanguage = majorLanguages.map(([name, list]) => ({
  language: name,
  repositories: list.length,
  medianComponents: median(list.map((row) => row.components)),
  ...Object.fromEntries(
    TRAIT_KEYS.map((key) => [
      key,
      pct(list.filter((row) => row[key]).length, list.length),
    ]),
  ),
  storage: pct(list.filter((row) => row.storage).length, list.length),
  workspace: pct(
    list.filter((row) => row.workspace.length > 0).length,
    list.length,
  ),
})) as Array<Record<string, number | string>>;

const ERAS = [
  { label: "Created before 2020", test: (y: number) => y < 2020 },
  { label: "2020 to 2022", test: (y: number) => y >= 2020 && y <= 2022 },
  { label: "2023 to 2024", test: (y: number) => y >= 2023 && y <= 2024 },
  { label: "2025 or later", test: (y: number) => y >= 2025 },
];
const byEra = ERAS.map((era) => {
  const list = rows.filter((row) => era.test(row.createdYear));
  return {
    era: era.label,
    repositories: list.length,
    llm: pct(list.filter((row) => row.llm).length, list.length),
    mcp: pct(list.filter((row) => row.mcp).length, list.length),
    agentActor: pct(list.filter((row) => row.agentActor).length, list.length),
  };
});

function topCounts(values: string[][], count: number) {
  const tally = new Map<string, number>();
  for (const list of values) {
    for (const value of new Set(list))
      tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name, repositories]) => ({ name, repositories }));
}

const fileName = (p: string) => p.split("/").pop() ?? p;
const entryFilesByLanguage = majorLanguages.slice(0, 6).map(([name, list]) => ({
  language: name,
  files: topCounts(
    list.map((row) =>
      row.linkedFiles
        .map(fileName)
        .filter((f) => f.includes(".") && !/^readme\.md$/i.test(f)),
    ),
    5,
  ),
}));

const workspaceRows = rows.filter((row) => row.workspace.length > 0);
const workspace = {
  count: workspaceRows.length,
  share: pct(workspaceRows.length, rows.length),
  folders: WORKSPACE_DIRS.map((dir) => ({
    name: `${dir}/`,
    repositories: rows.filter((row) => row.workspace.includes(dir)).length,
  })).sort((a, b) => b.repositories - a.repositories),
  examples: examples(workspaceRows),
  medianComponents: median(workspaceRows.map((row) => row.components)),
  medianComponentsOthers: median(
    rows
      .filter((row) => row.workspace.length === 0)
      .map((row) => row.components),
  ),
};

const goRows = languages.get("Go") ?? [];
const conventions = {
  goCmdInternal: pct(
    goRows.filter((row) =>
      row.linkedFiles.some(
        (f) => f.startsWith("cmd/") || f.startsWith("internal/"),
      ),
    ).length,
    goRows.length,
  ),
  goRepositories: goRows.length,
  rustCrates: pct(
    (languages.get("Rust") ?? []).filter((row) =>
      row.workspace.includes("crates"),
    ).length,
    (languages.get("Rust") ?? []).length,
  ),
  rustRepositories: (languages.get("Rust") ?? []).length,
  tsPackages: pct(
    (languages.get("TypeScript") ?? []).filter(
      (row) =>
        row.workspace.includes("packages") || row.workspace.includes("apps"),
    ).length,
    (languages.get("TypeScript") ?? []).length,
  ),
  tsRepositories: (languages.get("TypeScript") ?? []).length,
  readmeLinked: pct(
    rows.filter((row) =>
      row.linkedFiles.some((f) => /(^|\/)readme\.md$/i.test(f)),
    ).length,
    rows.length,
  ),
};

const evidenceRows = rows.filter((row) => row.citedConnections !== null);
const evidence = {
  diagrams: evidenceRows.length,
  connections: evidenceRows.reduce((sum, row) => sum + row.connections, 0),
  cited: evidenceRows.reduce(
    (sum, row) => sum + (row.citedConnections ?? 0),
    0,
  ),
};

const actorNames = topCounts(
  sample.map((item) =>
    item.graph.nodes
      .filter((node) => node.shape === "circle")
      .map((node) => node.label.trim().toLowerCase()),
  ),
  10,
);
const storageNames = topCounts(
  sample.map((item) =>
    item.graph.nodes
      .filter((node) => node.shape === "database")
      .map((node) => node.label.trim().toLowerCase()),
  ),
  10,
);
const groupNames = topCounts(
  rows.map((row) => row.groupNames.map((name) => name.trim().toLowerCase())),
  12,
);

const dates = rows.map((row) => row.diagramDate).sort();
const data = {
  slug: SLUG,
  computedAt: new Date().toISOString().slice(0, 10),
  indexReadAt: indexSummary.readAt.slice(0, 10),
  storedPublicDiagrams: indexSummary.indexEntries,
  candidatesRead: indexSummary.candidates.length,
  excluded: { withoutGraph, unavailable, forks, duplicates },
  sample: {
    size: rows.length,
    minStars: rows.at(-1)!.stars,
    maxStars: rows[0]!.stars,
    archived: rows.filter((row) => row.archived).length,
    diagramDates: { first: dates[0], last: dates.at(-1) },
    languages: [...languages.entries()]
      .map(([name, list]) => ({ name, repositories: list.length }))
      .sort((a, b) => b.repositories - a.repositories),
  },
  size: {
    components: quartiles(rows.map((row) => row.components)),
    connections: quartiles(rows.map((row) => row.connections)),
    groups: quartiles(rows.map((row) => row.groups)),
    linkedShare: pct(
      rows.reduce((sum, row) => sum + row.linkedComponents, 0),
      rows.reduce((sum, row) => sum + row.components, 0),
    ),
  },
  traits: traitTotals,
  storage: {
    count: rows.filter((row) => row.storage).length,
    share: pct(rows.filter((row) => row.storage).length, rows.length),
    names: storageNames,
    examples: examples(rows.filter((row) => row.storage)),
  },
  queue: {
    count: rows.filter((row) => row.queue).length,
    share: pct(rows.filter((row) => row.queue).length, rows.length),
    // Algorithm collections draw the queue data structure as a queue; the
    // examples show queues of work or events.
    examples: examples(
      sample
        .filter((item) =>
          item.graph.nodes.some(
            (node) =>
              node.shape === "queue" &&
              /\b(events?|jobs?|bus|streams?|tasks?|messages?|pub\/sub|workers?)\b/i.test(
                node.label,
              ),
          ),
        )
        .map((item) =>
          rows.find((row) => row.repository === item.meta.nameWithOwner)!,
        ),
    ),
  },
  actors: {
    share: pct(rows.filter((row) => row.outsideActor).length, rows.length),
    agentCount: rows.filter((row) => row.agentActor).length,
    agentShare: pct(rows.filter((row) => row.agentActor).length, rows.length),
    agentExamples: examples(rows.filter((row) => row.agentActor)),
    names: actorNames,
    rule: AGENT_ACTOR.source,
  },
  byLanguage,
  byEra,
  workspace,
  conventions,
  entryFilesByLanguage,
  groupNames,
  evidence: { ...evidence, share: pct(evidence.cited, evidence.connections) },
  topTen: rows.slice(0, 10).map((row) => ({
    repository: row.repository,
    url: row.url,
    stars: row.stars,
    language: row.language,
    components: row.components,
    groups: row.groupNames,
  })),
};

await writeFile(
  path.join(repoRoot, "src/features/architecture-report/data.json"),
  `${JSON.stringify(data, null, 2)}\n`,
);

// ---- Downloadable dataset -------------------------------------------------

const COLUMNS = [
  "rank",
  "repository",
  "url",
  "stars",
  "language",
  "createdYear",
  "archived",
  "components",
  "connections",
  "groups",
  "linkedComponents",
  "storage",
  "queue",
  "outsideActor",
  "agentActor",
  ...TRAIT_KEYS,
  "workspaceFolders",
  "citedConnections",
  "diagramDate",
] as const;
const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const datasetRows = rows.map(
  ({ linkedFiles: _l, groupNames: _g, workspace: w, ...rest }) => ({
    ...rest,
    workspaceFolders: w.join(" "),
  }),
);
await mkdir(path.join(repoRoot, "public/reports"), { recursive: true });
await writeFile(
  path.join(repoRoot, `public/reports/${SLUG}.csv`),
  [
    COLUMNS.join(","),
    ...datasetRows.map((row) =>
      COLUMNS.map((column) => csvCell(row[column as keyof typeof row])).join(
        ",",
      ),
    ),
  ].join("\n") + "\n",
);
await writeFile(
  path.join(repoRoot, `public/reports/${SLUG}.json`),
  `${JSON.stringify({
    title: "How the most-starred open-source repositories are built (2026)",
    source: `https://gitdiagram.com/reports/${SLUG}`,
    license: "CC BY 4.0",
    computedAt: data.computedAt,
    method: `The ${rows.length} most-starred non-fork public GitHub repositories with a stored GitDiagram architecture diagram. Stars and language from the GitHub API on ${data.indexReadAt}. Traits are regular-expression matches over each diagram's component and group names; see the rules.`,
    rules: Object.fromEntries(
      TRAIT_KEYS.map((key) => [key, TRAITS[key].rule.source]),
    ),
    agentActorRule: AGENT_ACTOR.source,
    repositories: datasetRows,
  })}\n`,
);
console.log(
  `sample ${rows.length}, min stars ${data.sample.minStars}; excluded`,
  data.excluded,
);
