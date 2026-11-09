import { GITHUB_REPO_URL, SITE_URL } from "~/lib/site";
import data from "./data.json";

// The architecture report: every number on the page, in the Markdown twin and
// in the downloads comes from data.json, which
// scripts/architecture-report/compute.ts writes. Nothing here is typed by hand.

export const REPORT = data;
export const REPORT_PATH = "/open-source-architecture-2026";
export const REPORT_URL = `${SITE_URL}${REPORT_PATH}`;
export const REPORT_PUBLISHED = "2026-11-09";
export const REPORT_DATASET = {
  csv: "/reports/open-source-architecture-2026.csv",
  json: "/reports/open-source-architecture-2026.json",
} as const;
export const REPORT_SCRIPTS = `${GITHUB_REPO_URL}/tree/main/scripts/architecture-report`;
export const REPORT_TITLE = `How the ${data.sample.size.toLocaleString("en-US")} most-starred open-source repositories are built (2026)`;
export const REPORT_DESCRIPTION = `What ${data.sample.size.toLocaleString("en-US")} architecture diagrams of the most-starred GitHub repositories show: a third of projects started since 2025 draw an AI agent as a user, how often they ship a CLI, a web UI, a data store or a monorepo, by language. Method and dataset included.`;

type Era = (typeof data.byEra)[number];
type Language = (typeof data.byLanguage)[number];
const eras = data.byEra as Era[];
const firstEra = eras[0]!;
const lastEra = eras.at(-1)!;
const llmPeak = [...eras].sort((a, b) => b.llm - a.llm)[0]!;
const trait = (key: string) => data.traits.find((t) => t.key === key)!;
const language = (name: string) =>
  (data.byLanguage as Language[]).find((row) => row.language === name)!;

const percent = (value: number) => `${value}%`;
const count = (value: number) => value.toLocaleString("en-US");

/** The headline findings, each a sentence with its numbers. */
export const REPORT_FINDINGS: Array<{ title: string; text: string }> = [
  {
    title: "AI agents are now drawn as users",
    text: `${percent(lastEra.agentActor)} of the repositories created in 2025 or later show an AI agent or coding assistant as one of the outside actors that use the software, next to people. Among repositories created before 2020 it is ${percent(firstEra.agentActor)}.`,
  },
  {
    title: "LLMs moved into the architecture",
    text: `A component for an LLM or AI model provider appears in ${percent(llmPeak.llm)} of repositories created ${llmPeak.era.toLowerCase().replace("created ", "")} and ${percent(firstEra.llm)} of those created before 2020. MCP shows up in ${percent(lastEra.mcp)} of the 2025-or-later repositories.`,
  },
  {
    title: "The command line beats the browser",
    text: `${percent(trait("cli").share)} of all diagrams include a command-line interface and ${percent(trait("web").share)} a web interface. In Rust it is ${percent(language("Rust").cli)} CLI, in Go ${percent(language("Go").cli)}.`,
  },
  {
    title: "Half keep state, few use queues",
    text: `${percent(data.storage.share)} draw a data store (a database, cache, file or object storage). Only ${percent(data.queue.share)} draw a queue or event bus.`,
  },
  {
    title: "Monorepos are a TypeScript and Rust habit",
    text: `${percent(data.workspace.share)} of diagrams link files in workspace folders (packages/, apps/, crates/, libs/, services/). For TypeScript it is ${percent(language("TypeScript").workspace)}, for Rust ${percent(language("Rust").workspace)}, for Python ${percent(language("Python").workspace)} and for Go ${percent(language("Go").workspace)}, where ${percent(data.conventions.goCmdInternal)} use the cmd/ and internal/ layout instead.`,
  },
  {
    title: "Plugin systems are common",
    text: `${percent(trait("plugins").share)} name a plugin or extension system, ${percent(language("JavaScript").plugins)} of JavaScript repositories.`,
  },
];

export const REPORT_LIMITS = [
  `The sample is the most-starred repositories that someone has diagrammed on GitDiagram, not every top repository on GitHub. It starts at ${count(data.sample.maxStars)} stars and ends at ${count(data.sample.minStars)}.`,
  "Diagrams are written by an AI model from the file tree, the README and up to 12 source files, then checked against the real tree. They show the main parts, not every file, and can miss or misname a part.",
  `Diagram size is set by GitDiagram, not by the repository: a diagram has at most 34 components, so the median of ${data.size.components.median} says more about the generator than about the code.`,
  "Traits are found by matching words in component and group names (the rules are below and in the dataset). A component named differently is missed; a name that matches by accident is counted.",
  `Lists, books and courses are included, because they are among the most-starred repositories (${count(data.sample.languages.find((l) => l.name === "No primary language")?.repositories ?? 0)} have no primary language).`,
  `Diagrams were made between ${data.sample.diagramDates.first} and ${data.sample.diagramDates.last}; a repository may have changed since its diagram was made.`,
];

/** The page as Markdown, for /open-source-architecture-2026.md. */
export function reportMarkdown(): string {
  const lines = [
    `# ${REPORT_TITLE}`,
    "",
    `Published ${REPORT_PUBLISHED} by GitDiagram. Source: ${REPORT_URL}`,
    "",
    `> ${REPORT_DESCRIPTION}`,
    "",
    "## Findings",
    "",
    ...REPORT_FINDINGS.map((f) => `- **${f.title}.** ${f.text}`),
    "",
    "## By year the repository was created",
    "",
    "| Created | Repositories | LLM component | MCP | AI agent as a user |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...eras.map(
      (e) =>
        `| ${e.era.replace("Created ", "")} | ${e.repositories} | ${percent(e.llm)} | ${percent(e.mcp)} | ${percent(e.agentActor)} |`,
    ),
    "",
    "## By primary language",
    "",
    "| Language | Repositories | CLI | Web UI | Plugins | Data store | Workspace folders | LLM |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...(data.byLanguage as Language[]).map(
      (l) =>
        `| ${l.language} | ${l.repositories} | ${percent(l.cli)} | ${percent(l.web)} | ${percent(l.plugins)} | ${percent(l.storage)} | ${percent(l.workspace)} | ${percent(l.llm)} |`,
    ),
    "",
    "## The ten most-starred repositories in the sample",
    "",
    ...data.topTen.map(
      (r) =>
        `- [${r.repository}](${r.url}) (${count(r.stars)} stars, ${r.language ?? "no primary language"}): ${r.components} components in ${r.groups.length} groups: ${r.groups.join(", ")}.`,
    ),
    "",
    "## Method",
    "",
    `GitDiagram stores an architecture diagram for each public repository someone generates (${count(data.storedPublicDiagrams)} on ${data.indexReadAt}). We took the ${count(data.candidatesRead)} with the most stars, kept those whose diagram has a component graph, dropped forks and repositories stored under an old name, and kept the ${count(data.sample.size)} most-starred by GitHub's count on ${data.indexReadAt}. Primary language and creation year come from the GitHub API. A trait counts when a regular expression matches a component or group name:`,
    "",
    ...data.traits.map((t) => `- ${t.label}: \`/${t.rule}/\``),
    `- AI agent as a user: an outside actor (circle) matching \`/${data.actors.rule}/\``,
    "- Data store: a component drawn as a database. Queue: a component drawn as a queue.",
    "- Workspace folders: a component linked to a file under packages/, apps/, crates/, libs/ or services/.",
    "",
    "## Limits",
    "",
    ...REPORT_LIMITS.map((l) => `- ${l}`),
    "",
    "## Data",
    "",
    `- CSV: ${SITE_URL}${REPORT_DATASET.csv}`,
    `- JSON: ${SITE_URL}${REPORT_DATASET.json}`,
    `- Scripts: ${REPORT_SCRIPTS}`,
    "",
    `License: CC BY 4.0. Cite as: GitDiagram, "${REPORT_TITLE}", ${REPORT_PUBLISHED}, ${REPORT_URL}`,
  ];
  return `${lines.join("\n")}\n`;
}
