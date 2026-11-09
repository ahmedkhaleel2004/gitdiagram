import { SITE_URL } from "~/lib/site";
import data from "./data.json";

// /most-starred-repositories: one crawlable page that links the diagram of
// every most-starred GitHub repository GitDiagram has a current diagram for.
// Built by scripts/popular-repos/build.ts from GitHub's search API and the
// public diagrams; nothing on it is written by hand.

export interface PopularRepository {
  /** "owner/repo" as GitHub spells it. */
  repository: string;
  stars: number;
  language: string | null;
  /** The first sentences of the diagram's explanation. */
  summary: string | null;
  /** The diagram's last successful run, YYYY-MM-DD. */
  updated: string;
}

export const POPULAR = data as {
  checked: string;
  githubTopChecked: number;
  entries: PopularRepository[];
};
export const POPULAR_PATH = "/most-starred-repositories";
export const POPULAR_URL = `${SITE_URL}${POPULAR_PATH}`;
export const POPULAR_META_TITLE =
  "Most-starred GitHub repos: architecture diagrams";
export const POPULAR_TITLE =
  "Architecture diagrams of the most-starred GitHub repositories";

const count = POPULAR.entries.length.toLocaleString("en-US");
export const POPULAR_DESCRIPTION = `How ${count} of the most-starred repositories on GitHub are structured: an interactive architecture diagram for each, with every component linked to its source code.`;

export const repositoryPath = (repository: string) =>
  `/${repository.toLowerCase()}`;

export const formatStars = (stars: number) =>
  stars >= 1000
    ? `${(stars / 1000).toFixed(stars >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`
    : String(stars);

/** The opening paragraph, shared by the page and its Markdown twin. */
export function popularIntro(): string {
  const entries = POPULAR.entries;
  const top = entries[0];
  const last = entries.at(-1);
  const range =
    top && last
      ? ` They run from ${top.repository} (${formatStars(top.stars)} stars) to ${last.repository} (${formatStars(last.stars)}).`
      : "";
  return `These are the ${count} most-starred GitHub repositories that have a current GitDiagram architecture diagram, ranked by stars (checked ${POPULAR.checked} against the ${POPULAR.githubTopChecked.toLocaleString("en-US")} most-starred repositories on GitHub).${range} Each link opens the repository's diagram: its main components, how they connect, and a link from each component to its code on GitHub, generated from the file tree, README and a sample of source files. They are AI-made overviews: check details against the source.`;
}

export function popularMarkdown(): string {
  const lines = [
    `# ${POPULAR_TITLE}`,
    "",
    popularIntro(),
    "",
    `Page: ${POPULAR_URL}. Each repository also has a Markdown version of its diagram at gitdiagram.com/{owner}/{repo}.md.`,
    "",
  ];
  POPULAR.entries.forEach((entry, index) => {
    const facts = [`${formatStars(entry.stars)} stars`, entry.language].filter(
      Boolean,
    );
    lines.push(
      `${index + 1}. [${entry.repository}](${SITE_URL}${repositoryPath(entry.repository)}) (${facts.join(", ")})${entry.summary ? `: ${entry.summary}` : ""}`,
    );
  });
  return `${lines.join("\n")}\n`;
}
