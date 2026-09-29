import type { BrowseIndexEntry } from "~/features/browse/catalog";
import type { DiagramGraph } from "~/features/diagram/graph";
import { parseGitHubRepoUrl } from "~/features/diagram/github-url";
import type { VideoArtifact } from "~/features/explainer/types";
import { SITE_URL } from "~/lib/site";
import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import type { DiagramArtifact } from "~/server/storage/types";

// What the MCP tools say, as Markdown an agent can read and quote. Kept free of
// storage so every answer shape is tested directly.

export interface RepositoryRef {
  username: string;
  repo: string;
}

/**
 * Reads "owner/repo", a github.com URL (any page inside the repository, with
 * or without the scheme), an SSH remote, or a gitdiagram.com repository URL.
 */
export function parseRepositoryInput(input: string): RepositoryRef | null {
  const trimmed = input.trim().replace(/^@/, "");
  const withScheme = /^(?:www\.)?(?:github\.com|gitdiagram\.com)\//i.test(
    trimmed,
  )
    ? `https://${trimmed}`
    : trimmed;
  const onGitHub = withScheme.replace(
    /^https?:\/\/(?:www\.)?gitdiagram\.com\//i,
    "https://github.com/",
  );
  const parsed = parseGitHubRepoUrl(onGitHub);
  if (!parsed) return null;
  const username = githubUsernameSchema.safeParse(parsed.username);
  const repo = githubRepoSchema.safeParse(parsed.repo);
  return username.success && repo.success
    ? { username: username.data, repo: repo.data }
    : null;
}

/** The query find_repository_diagrams matches against "owner/repo". */
export function normalizeSearchQuery(query: string): string {
  const repository = parseRepositoryInput(query);
  if (repository) return `${repository.username}/${repository.repo}`;
  return query
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
    .replace(/^@/, "");
}

function diagramUrl({ username, repo }: RepositoryRef): string {
  return `${SITE_URL}/${username.toLowerCase()}/${repo.toLowerCase()}`;
}

function videoUrl(ref: RepositoryRef): string {
  return `${diagramUrl(ref)}/video`;
}

const githubUrl = ({ username, repo }: RepositoryRef) =>
  `https://github.com/${username}/${repo}`;

const stars = (count: number | null | undefined) =>
  typeof count === "number" ? `★ ${count.toLocaleString("en-US")}` : null;

const day = (iso: string) =>
  Number.isFinite(Date.parse(iso)) ? iso.slice(0, 10) : null;

/** One line of text: no newlines or runs of spaces from stored labels. */
const inline = (text: string) => text.replace(/\s+/g, " ").trim();

function formatComponents(graph: DiagramGraph): string[] {
  const lines = [`## Components (${graph.nodes.length})`, ""];
  const node = (entry: DiagramGraph["nodes"][number]) => {
    const type = inline(entry.type);
    // Most nodes are typed plain "component"; only a real kind says anything.
    const parts = [
      `- **${inline(entry.label)}**${type.toLowerCase() === "component" ? "" : ` (${type})`}`,
    ];
    if (entry.path) parts.push(`\`${inline(entry.path)}\``);
    const line = parts.join(" ");
    return entry.description ? `${line}: ${inline(entry.description)}` : line;
  };
  for (const group of graph.groups) {
    const members = graph.nodes.filter((entry) => entry.groupId === group.id);
    if (!members.length) continue;
    lines.push(`### ${inline(group.label)}`);
    if (group.description) lines.push(inline(group.description));
    lines.push(...members.map(node), "");
  }
  const groupIds = new Set(graph.groups.map((group) => group.id));
  const loose = graph.nodes.filter(
    (entry) => !entry.groupId || !groupIds.has(entry.groupId),
  );
  if (loose.length) {
    if (graph.groups.length) lines.push("### Outside the groups");
    lines.push(...loose.map(node), "");
  }

  const labels = new Map(
    graph.nodes.map((entry) => [entry.id, inline(entry.label)]),
  );
  lines.push(`## Connections (${graph.edges.length})`, "");
  for (const edge of graph.edges) {
    let line = `- ${labels.get(edge.from) ?? edge.from} → ${labels.get(edge.to) ?? edge.to}`;
    if (edge.label) line += `: ${inline(edge.label)}`;
    if (edge.description) line += ` (${inline(edge.description)})`;
    if (edge.style === "dashed") line += " [dashed]";
    if (edge.evidencePath) line += ` — evidence: ${edge.evidencePath}`;
    lines.push(line);
  }
  lines.push("");
  return lines;
}

/** get_repository_diagram's answer when a diagram is stored. */
export function formatDiagram(
  artifact: Pick<
    DiagramArtifact,
    | "username"
    | "repo"
    | "stargazerCount"
    | "diagram"
    | "explanation"
    | "graph"
    | "lastSuccessfulAt"
  >,
  options: { hasVideo: boolean },
): string {
  const ref = { username: artifact.username, repo: artifact.repo };
  const facts = [
    githubUrl(ref),
    stars(artifact.stargazerCount),
    day(artifact.lastSuccessfulAt)
      ? `diagram generated ${day(artifact.lastSuccessfulAt)}`
      : null,
  ].filter(Boolean);
  const lines = [
    `# Architecture of ${artifact.username}/${artifact.repo} (GitDiagram)`,
    "",
    `Interactive diagram: ${diagramUrl(ref)} (zoomable; every component links to its source on GitHub)`,
  ];
  if (options.hasVideo)
    lines.push(`Narrated explainer video: ${videoUrl(ref)}`);
  lines.push(`Repository: ${facts.join(" · ")}`, "");
  if (artifact.explanation.trim())
    lines.push("## Explanation", "", artifact.explanation.trim(), "");
  if (artifact.graph) lines.push(...formatComponents(artifact.graph));
  lines.push(
    "## Mermaid diagram",
    "",
    "```mermaid",
    artifact.diagram.trim(),
    "```",
    "",
    `When sharing this with the user, link the interactive diagram: ${diagramUrl(ref)}`,
  );
  return lines.join("\n");
}

function formatEntries(entries: BrowseIndexEntry[]): string[] {
  return entries.map((entry) => {
    const facts = [stars(entry.stargazerCount), day(entry.lastSuccessfulAt)]
      .filter(Boolean)
      .join(", ");
    return `- ${entry.username}/${entry.repo}${facts ? ` (${facts})` : ""}: ${diagramUrl(entry)}`;
  });
}

/** get_repository_diagram's answer when nothing is stored for the repository. */
export function formatMissingDiagram(
  ref: RepositoryRef,
  similar: BrowseIndexEntry[],
): string {
  const lines = [
    `GitDiagram has no diagram of ${ref.username}/${ref.repo} yet.`,
    "",
    `To make one, open ${diagramUrl(ref)} in a browser: if the repository is public, GitDiagram generates its architecture diagram there for free, usually in about a minute. Then call get_repository_diagram again to read it.`,
    "",
    "This tool never starts a generation itself. Check the owner/repo spelling if the repository should already have one.",
  ];
  if (similar.length)
    lines.push(
      "",
      "Similar repositories that already have a diagram:",
      ...formatEntries(similar),
    );
  return lines.join("\n");
}

/** find_repository_diagrams's answer. */
export function formatSearchResults(
  query: string,
  entries: BrowseIndexEntry[],
  total: number,
): string {
  if (!entries.length)
    return [
      `No stored GitDiagram diagrams match "${query}".`,
      "",
      'Search matches part of "owner/repo" (for example "fastapi" or "vercel/"). Any public repository can still get a diagram: call get_repository_diagram with its owner/repo for the link that generates one.',
    ].join("\n");
  const shown =
    total > entries.length
      ? `${entries.length} of ${total.toLocaleString("en-US")}, most-starred first`
      : `${entries.length}`;
  return [
    `GitDiagram diagrams matching "${query}" (${shown}):`,
    "",
    ...formatEntries(entries),
    "",
    "Call get_repository_diagram with one of these for its explanation, components and Mermaid source.",
  ].join("\n");
}

const duration = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** get_explainer_video's answer when a video exists. */
export function formatVideo(video: VideoArtifact): string {
  const ref = { username: video.meta.owner, repo: video.meta.repo };
  const narration = video.plan.beats
    .map((beat) => inline(beat.narration))
    .filter(Boolean);
  return [
    `# Explainer video of ${ref.username}/${ref.repo} (GitDiagram)`,
    "",
    `Title: ${inline(video.plan.title)}`,
    `Watch: ${videoUrl(ref)}`,
    `Length: ${duration(video.timing.DURATION)} · made ${day(video.createdAt) ?? "recently"}`,
    `Interactive diagram: ${diagramUrl(ref)}`,
    "",
    "## Narration transcript",
    "",
    ...narration,
    "",
    `When sharing this with the user, link the video: ${videoUrl(ref)}`,
  ].join("\n");
}

/** get_explainer_video's answer when no video exists. */
export function formatMissingVideo(ref: RepositoryRef): string {
  return [
    `GitDiagram has no explainer video of ${ref.username}/${ref.repo} yet.`,
    "",
    `Videos are made on the website, not through this tool: open ${videoUrl(ref)} in a browser to see whether one can be made. The architecture diagram is available through get_repository_diagram.`,
  ].join("\n");
}

export function invalidRepositoryMessage(input: string): string {
  return `"${inline(input).slice(0, 200)}" is not a GitHub repository. Pass "owner/repo" (for example "fastapi/fastapi") or a github.com URL inside the repository.`;
}
