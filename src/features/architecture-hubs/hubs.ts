import {
  AGENT_ACTOR,
  TRAITS,
  TRAIT_KEYS,
  WORKSPACE_DIRS,
  graphNames,
  topFolders,
} from "~/features/architecture-report/traits";

// Architecture hubs (/architecture-examples/{hub}): lists of public diagrams
// by GitHub language and by kind of project, with a short summary of what
// the most-starred ones have in common. Built once a day from the browse index
// and the stored diagrams into small objects in the public bucket
// (server/storage/architecture-hubs.ts); a page reads only its own objects,
// never the index (a Worker isolate over 128 MB is killed).

export const HUBS_PATH = "/architecture-examples";
/** Repositories per page. */
export const HUB_PAGE_SIZE = 50;
/** The most a hub lists (20 pages). */
export const HUB_MAX_REPOSITORIES = 1000;
/** A hub with fewer repositories is not published. */
export const HUB_MIN_REPOSITORIES = 40;
/** Only repositories with at least this many stars are listed. */
const HUB_MIN_STARS = 10;
/** The summary reads this many of a hub's most-starred diagrams. */
const HUB_PATTERN_SAMPLE = 200;
/** With fewer read diagrams than this, a hub shows no summary yet. */
const HUB_PATTERN_MIN_SAMPLE = 25;

/**
 * GitHub "languages" that are markup, notebooks or documents: their
 * repositories are courses, lists and sites rather than software with an
 * architecture, so they get no hub of their own.
 */
const NOT_A_LANGUAGE_HUB = new Set([
  "markdown",
  "mdx",
  "tex",
  "html",
  "css",
  "scss",
  "jupyter notebook",
  "dockerfile",
  "makefile",
  "roff",
  "text",
  "rich text format",
]);

export function languageSlug(language: string): string {
  return language
    .trim()
    .toLowerCase()
    .replaceAll("+", "p")
    .replaceAll("#", "sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function hasLanguageHub(language: string): boolean {
  return (
    !NOT_A_LANGUAGE_HUB.has(language.trim().toLowerCase()) &&
    languageSlug(language) !== ""
  );
}

// ---- What each stored diagram shows ---------------------------------------

/** Signs, beyond the report's traits, used to sort projects by kind. */
const EXTRA_RULES = {
  // An AI agent framework or app names a component or group as an agent.
  agent: /\bagents?\b|\bagentic\b/,
  // The inside of a database: at least two of these parts.
  dbengine:
    /\bstorage engines?\b|\bquery (engines?|planners?|optimi[sz]ers?|executors?|execution|processing)\b|\bsql (parsers?|engines?)\b|\bwrite[- ]ahead logs?\b|\bwal\b|\bb\+?-?trees?\b|\blsm\b|\bbuffer (pools?|managers?)\b|\btransaction (managers?|engines?)\b|\bindex(es|ing)? engines?\b|\bcompaction\b|\bmemtables?\b/g,
  // Several deployable services: "microservices", or at least four
  // components named as a service next to an API gateway or service mesh.
  microservices: /\bmicro-?services?\b/,
  gateway:
    /\bapi gateways?\b|\bservice mesh\b|\bservice (discovery|registry)\b/,
  service: /\bservices?$/,
} as const;

type FactTrait =
  | (typeof TRAIT_KEYS)[number]
  | "storage"
  | "queue"
  | "workspace"
  | "agentActor"
  | "agent"
  | "dbengine"
  | "microservices";

/** The few facts a hub needs from one stored diagram (kept small). */
export interface RepositoryFacts {
  /** Components. */
  n: number;
  /** Traits it matches. */
  t: FactTrait[];
  /** Group names, lowercased. */
  g: string[];
  /** Kinds of data store its database-shaped components are (STORE_KINDS). */
  s: string[];
  /** File names its components link to. */
  f: string[];
}

interface FactsGraph {
  nodes: ReadonlyArray<{
    label: string;
    shape?: string | null;
    path?: string | null;
  }>;
  groups: ReadonlyArray<{ label: string }>;
}

/**
 * What a database-shaped component is, from its name. One that matches none
 * counts for no kind (it is still a data store).
 */
const STORE_KINDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["PostgreSQL", /postgres/],
  ["SQLite", /sqlite/],
  ["MySQL or MariaDB", /mysql|mariadb/],
  ["Redis", /redis|valkey/],
  ["MongoDB", /mongo/],
  ["Elasticsearch or OpenSearch", /elastic|opensearch/],
  [
    "a vector store",
    /vector|embedding|chroma|qdrant|pinecone|milvus|faiss|weaviate/,
  ],
  ["object storage (S3 and similar)", /\bs3\b|object stor|\bblobs?\b|minio/],
  ["a cache", /cache/],
  ["files on disk", /\bfiles?\b|file ?system|\bdisk\b|local stor/],
];

function storeKinds(label: string): string[] {
  const name = label.toLowerCase();
  return STORE_KINDS.filter(([, rule]) => rule.test(name)).map(
    ([kind]) => kind,
  );
}

const fileName = (path: string) => path.split("/").pop() ?? path;
const unique = (values: string[]) => [...new Set(values)];

export function repositoryFacts(graph: FactsGraph): RepositoryFacts {
  const text = graphNames(graph);
  const traits: FactTrait[] = TRAIT_KEYS.filter((key) =>
    TRAITS[key].rule.test(text),
  );
  if (graph.nodes.some((node) => node.shape === "database"))
    traits.push("storage");
  if (graph.nodes.some((node) => node.shape === "queue")) traits.push("queue");
  const folders = topFolders(graph);
  if (WORKSPACE_DIRS.some((dir) => folders.has(dir))) traits.push("workspace");
  if (
    graph.nodes.some(
      (node) =>
        node.shape === "circle" && AGENT_ACTOR.test(node.label.toLowerCase()),
    )
  )
    traits.push("agentActor");
  if (EXTRA_RULES.agent.test(text)) traits.push("agent");
  const engineParts = new Set(
    [...text.matchAll(EXTRA_RULES.dbengine)].map((match) => match[0]),
  );
  if (engineParts.size >= 2) traits.push("dbengine");
  const services = graph.nodes.filter((node) =>
    EXTRA_RULES.service.test(node.label.trim().toLowerCase()),
  ).length;
  if (
    EXTRA_RULES.microservices.test(text) ||
    (services >= 4 && EXTRA_RULES.gateway.test(text))
  )
    traits.push("microservices");
  return {
    n: graph.nodes.length,
    t: traits,
    g: unique(graph.groups.map((group) => group.label.trim().toLowerCase()))
      .filter(Boolean)
      .slice(0, 10),
    s: unique(
      graph.nodes
        .filter((node) => node.shape === "database")
        .flatMap((node) => storeKinds(node.label)),
    ),
    f: unique(
      graph.nodes
        .map((node) => node.path)
        .filter((path): path is string => Boolean(path))
        .map(fileName)
        .filter((name) => name.includes(".") && !/^readme\.md$/i.test(name)),
    ).slice(0, 12),
  };
}

// ---- Kinds of project -----------------------------------------------------

interface HubKind {
  slug: string;
  /** "AI agents": what the page lists. */
  name: string;
  /** The page's heading. */
  heading: string;
  /** Who is in it, in plain words; printed on the page. */
  rule: string;
  matches: (facts: RepositoryFacts) => boolean;
}

const has = (facts: RepositoryFacts, trait: FactTrait) =>
  facts.t.includes(trait);

const HUB_KINDS: readonly HubKind[] = [
  {
    slug: "ai-agents",
    name: "AI agents",
    heading: "AI agent architecture examples",
    rule: "the diagram has an LLM or AI-model component and a component or group named as an agent",
    matches: (facts) => has(facts, "llm") && has(facts, "agent"),
  },
  {
    slug: "mcp",
    name: "projects that speak MCP",
    heading: "MCP server and client architecture examples",
    rule: "a component or group speaks MCP (the Model Context Protocol)",
    matches: (facts) => has(facts, "mcp"),
  },
  {
    slug: "cli-tools",
    name: "CLI tools and command-line projects",
    heading: "CLI tool architecture examples",
    rule: "the diagram has a command-line or terminal interface component",
    matches: (facts) => has(facts, "cli"),
  },
  {
    slug: "web-apps",
    name: "web apps",
    heading: "Web app architecture examples",
    rule: "the diagram has a web interface: a web UI, frontend or dashboard",
    matches: (facts) => has(facts, "web"),
  },
  {
    slug: "desktop-apps",
    name: "desktop apps",
    heading: "Desktop app architecture examples",
    rule: "the diagram has a desktop app (including Electron and Tauri)",
    matches: (facts) => has(facts, "desktop"),
  },
  {
    slug: "databases",
    name: "databases and storage engines",
    heading: "Database architecture examples",
    rule: "the diagram names at least two inner parts of a database, such as a storage engine, query planner, write-ahead log, B-tree, LSM tree or buffer pool",
    matches: (facts) => has(facts, "dbengine"),
  },
  {
    slug: "microservices",
    name: "microservices",
    heading: "Microservices architecture examples",
    rule: "the diagram names microservices, or has at least four components named as services next to an API gateway, service mesh or service registry",
    matches: (facts) => has(facts, "microservices"),
  },
];

// ---- Stored objects -------------------------------------------------------

/** One repository the browse index lists, with what the hub needs. */
export interface HubCandidate {
  owner: string;
  repo: string;
  stars: number;
  language: string;
  /** When its diagram was last made: a newer one is read again. */
  at: string;
}

/** What was read from one stored diagram. */
export interface RepositoryDetail {
  at: string;
  /** First sentences of its written overview. */
  d?: string;
  facts?: RepositoryFacts;
  /** No stored public diagram: left out of every hub. */
  missing?: true;
}

export interface HubDetails {
  version: 1;
  updatedAt: string;
  /** By lowercase owner/repo. */
  repositories: Record<string, RepositoryDetail>;
}

export interface HubListItem {
  owner: string;
  repo: string;
  stars: number;
  language?: string;
  description?: string;
}

interface HubShare {
  key: FactTrait;
  label: string;
  /** Percent of the sample, one decimal. */
  share: number;
}

interface HubCount {
  name: string;
  repositories: number;
}

interface HubPatterns {
  /** Diagrams read for the summary. */
  sample: number;
  medianComponents: number;
  shares: HubShare[];
  groupNames: HubCount[];
  dataStores: HubCount[];
  files: HubCount[];
  /** Kind hubs only: the languages in the sample. */
  languages?: HubCount[];
}

export interface HubSummary {
  slug: string;
  kind: "language" | "type";
  /** "Python", or "AI agents". */
  name: string;
  /** Kind hubs: who is in it. */
  rule?: string;
  total: number;
  pages: number;
  patterns: HubPatterns | null;
  /** The three most-starred, owner/repo. */
  top: string[];
}

export interface HubIndex {
  version: 1;
  updatedAt: string;
  /** Repositories read for the hubs (with a language and enough stars). */
  candidates: number;
  hubs: HubSummary[];
}

export interface HubPage {
  version: 1;
  updatedAt: string;
  slug: string;
  page: number;
  items: HubListItem[];
}

// ---- Building -------------------------------------------------------------

export const repositoryKey = (owner: string, repo: string) =>
  `${owner}/${repo}`.toLowerCase();

function byStars(left: HubCandidate, right: HubCandidate) {
  return (
    right.stars - left.stars ||
    repositoryKey(left.owner, left.repo).localeCompare(
      repositoryKey(right.owner, right.repo),
    )
  );
}

/**
 * The repositories hubs are built from: every one with a language and enough
 * stars, at most HUB_MAX_REPOSITORIES per language, most stars first.
 * Duplicate index entries (the same repository twice) keep the first.
 */
export function hubCandidates(
  entries: ReadonlyArray<{
    username: string;
    repo: string;
    stargazerCount: number | null;
    language?: string;
    lastSuccessfulAt: string;
  }>,
): HubCandidate[] {
  const byLanguage = new Map<string, HubCandidate[]>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const language = entry.language?.trim();
    const stars = entry.stargazerCount ?? 0;
    if (!language || stars < HUB_MIN_STARS) continue;
    const key = repositoryKey(entry.username, entry.repo);
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byLanguage.get(language) ?? [];
    list.push({
      owner: entry.username,
      repo: entry.repo,
      stars,
      language,
      at: entry.lastSuccessfulAt,
    });
    byLanguage.set(language, list);
  }
  return [...byLanguage.values()].flatMap((list) =>
    list.sort(byStars).slice(0, HUB_MAX_REPOSITORIES),
  );
}

/** Candidates whose stored diagram must be read (new, or made again). */
export function candidatesToRead(
  candidates: readonly HubCandidate[],
  details: HubDetails["repositories"],
): HubCandidate[] {
  return candidates
    .filter(
      (candidate) =>
        details[repositoryKey(candidate.owner, candidate.repo)]?.at !==
        candidate.at,
    )
    .sort(byStars);
}

const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function topCounts(lists: string[][], count: number, min: number) {
  const tally = new Map<string, number>();
  for (const list of lists) {
    for (const value of new Set(list))
      tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  return [...tally.entries()]
    .filter(([, repositories]) => repositories >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name, repositories]) => ({ name, repositories }));
}

const SHARE_LABELS: ReadonlyArray<readonly [FactTrait, string]> = [
  ["storage", "Draws a data store"],
  ["cli", "Has a command-line interface"],
  ["web", "Has a web interface"],
  ["plugins", "Has plugins or extensions"],
  ["llm", "Has an LLM or AI-model component"],
  ["workspace", "Split into workspace packages"],
  ["queue", "Draws a queue or event bus"],
  ["mcp", "Speaks MCP"],
  ["desktop", "Has a desktop app"],
];

function hubPatterns(
  members: ReadonlyArray<{ candidate: HubCandidate; facts?: RepositoryFacts }>,
  withLanguages: boolean,
): HubPatterns | null {
  const sample = members
    .filter(
      (member): member is { candidate: HubCandidate; facts: RepositoryFacts } =>
        Boolean(member.facts),
    )
    .slice(0, HUB_PATTERN_SAMPLE);
  if (sample.length < HUB_PATTERN_MIN_SAMPLE) return null;
  const facts = sample.map((member) => member.facts);
  const min = Math.max(2, Math.ceil(sample.length * 0.03));
  return {
    sample: sample.length,
    medianComponents: median(facts.map((item) => item.n)),
    shares: SHARE_LABELS.map(([key, label]) => ({
      key,
      label,
      share: pct(
        facts.filter((item) => item.t.includes(key)).length,
        facts.length,
      ),
    })),
    groupNames: topCounts(
      facts.map((item) => item.g),
      8,
      min,
    ),
    dataStores: topCounts(
      facts.map((item) => item.s),
      5,
      min,
    ),
    files: topCounts(
      facts.map((item) => item.f),
      6,
      min,
    ),
    ...(withLanguages
      ? {
          languages: topCounts(
            sample.map((member) => [member.candidate.language]),
            6,
            1,
          ),
        }
      : {}),
  };
}

export interface BuiltHub {
  summary: HubSummary;
  pages: HubListItem[][];
}

function buildHub(
  base: Omit<HubSummary, "total" | "pages" | "patterns" | "top">,
  members: HubCandidate[],
  details: HubDetails["repositories"],
): BuiltHub {
  const listed = members.slice(0, HUB_MAX_REPOSITORIES);
  const withFacts = listed.map((candidate) => ({
    candidate,
    facts: details[repositoryKey(candidate.owner, candidate.repo)]?.facts,
  }));
  const items: HubListItem[] = listed.map((candidate) => {
    const detail = details[repositoryKey(candidate.owner, candidate.repo)];
    return {
      owner: candidate.owner,
      repo: candidate.repo,
      stars: candidate.stars,
      ...(base.kind === "type" ? { language: candidate.language } : {}),
      ...(detail?.d ? { description: detail.d } : {}),
    };
  });
  const pages: HubListItem[][] = [];
  for (let start = 0; start < items.length; start += HUB_PAGE_SIZE) {
    pages.push(items.slice(start, start + HUB_PAGE_SIZE));
  }
  return {
    summary: {
      ...base,
      total: listed.length,
      pages: pages.length,
      patterns: hubPatterns(withFacts, base.kind === "type"),
      top: listed
        .slice(0, 3)
        .map((candidate) => `${candidate.owner}/${candidate.repo}`),
    },
    pages,
  };
}

/**
 * Every hub with enough repositories: one per language, then one per kind of
 * project. Repositories whose stored diagram is gone are left out; ones not
 * read yet are listed without a description and count toward no kind.
 */
export function buildHubs(
  candidates: readonly HubCandidate[],
  details: HubDetails["repositories"],
): BuiltHub[] {
  const present = candidates
    .filter(
      (candidate) =>
        !details[repositoryKey(candidate.owner, candidate.repo)]?.missing,
    )
    .sort(byStars);
  const byLanguage = new Map<string, HubCandidate[]>();
  for (const candidate of present) {
    if (!hasLanguageHub(candidate.language)) continue;
    const list = byLanguage.get(candidate.language) ?? [];
    list.push(candidate);
    byLanguage.set(candidate.language, list);
  }
  const hubs: BuiltHub[] = [];
  const slugs = new Set<string>();
  for (const [language, members] of [...byLanguage.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )) {
    const slug = languageSlug(language);
    if (members.length < HUB_MIN_REPOSITORIES || slugs.has(slug)) continue;
    slugs.add(slug);
    hubs.push(
      buildHub({ slug, kind: "language", name: language }, members, details),
    );
  }
  for (const kind of HUB_KINDS) {
    const members = present.filter((candidate) => {
      const facts =
        details[repositoryKey(candidate.owner, candidate.repo)]?.facts;
      return facts ? kind.matches(facts) : false;
    });
    if (members.length < HUB_MIN_REPOSITORIES) continue;
    hubs.push(
      buildHub(
        { slug: kind.slug, kind: "type", name: kind.name, rule: kind.rule },
        members,
        details,
      ),
    );
  }
  return hubs;
}

// ---- Paths and words --------------------------------------------------------

export function hubPath(slug: string, page = 1): string {
  return page > 1 ? `${HUBS_PATH}/${slug}/${page}` : `${HUBS_PATH}/${slug}`;
}

export function repositoryPath(owner: string, repo: string): string {
  return `/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}`;
}

/** "Python projects", or "AI agents". */
export function hubSubject(hub: Pick<HubSummary, "kind" | "name">): string {
  return hub.kind === "language" ? `${hub.name} projects` : hub.name;
}

/** The page's heading: "Python project architecture examples". */
export function hubHeading(hub: Pick<HubSummary, "kind" | "name">): string {
  if (hub.kind === "language")
    return `${hub.name} project architecture examples`;
  return (
    HUB_KINDS.find((kind) => kind.name === hub.name)?.heading ??
    `${hub.name.charAt(0).toUpperCase()}${hub.name.slice(1)} architecture examples`
  );
}
