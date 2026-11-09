import { SITE_URL } from "~/lib/site";
import { guidePlainText } from "~/features/guide/content";
import {
  COMPARE_CHECKED,
  COMPARE_PAGES,
  ROUNDUP_DESCRIPTION,
  ROUNDUP_DISCLOSURE,
  ROUNDUP_NOTES,
  ROUNDUP_PATH,
  ROUNDUP_QUESTIONS,
  ROUNDUP_SOURCES,
  ROUNDUP_TITLE,
  ROUNDUP_TOOLS,
  ROUNDUP_VERDICT,
  comparePath,
  type ComparePage,
} from "./content";

// The comparison pages as Markdown: /compare/{slug}.md (the proxy rewrites it
// to ./llms.txt like a repository's twin) and the end of /llms-full.txt.

function absolute(href: string): string {
  return href.startsWith("/") ? `${SITE_URL}${href}` : href;
}

function markdownText(text: string): string {
  return text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label: string, href: string) => `[${label}](${absolute(href)})`,
  );
}

/** A table cell: one line, no pipes. */
function cell(text: string): string {
  return markdownText(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function comparePageMarkdown(page: ComparePage, level = 1): string {
  const h = (n: number) => "#".repeat(level + n - 1);
  const lines = [
    `${h(1)} ${page.title}`,
    "",
    `Source: ${SITE_URL}${comparePath(page.slug)}. Written by GitDiagram; facts about ${page.tool} checked against its own docs on ${COMPARE_CHECKED}.`,
    "",
    markdownText(page.verdict),
    "",
    `${h(2)} Which to choose`,
    "",
    `**Choose ${page.tool} when:**`,
    "",
    ...page.chooseOther.map((line) => `- ${markdownText(line)}`),
    "",
    "**Choose GitDiagram when:**",
    "",
    ...page.chooseGitDiagram.map((line) => `- ${markdownText(line)}`),
    "",
  ];
  for (const section of page.sections) {
    lines.push(`${h(2)} ${section.heading}`, "");
    for (const paragraph of section.paragraphs)
      lines.push(markdownText(paragraph), "");
    if (section.code)
      lines.push(
        `${section.code.caption}:`,
        "",
        "```",
        section.code.text,
        "```",
        "",
      );
  }
  lines.push(
    `${h(2)} At a glance`,
    "",
    `| | GitDiagram | ${page.tool} |`,
    "| --- | --- | --- |",
    ...page.facts.map(
      (fact) =>
        `| ${fact.label} | ${cell(fact.gitdiagram)} | ${cell(fact.other)} |`,
    ),
    "",
    `${h(2)} Questions`,
    "",
  );
  for (const { question, answer } of page.questions)
    lines.push(`${h(3)} ${question}`, "", markdownText(answer), "");
  lines.push(`${h(2)} Sources (checked ${COMPARE_CHECKED})`, "");
  for (const source of page.sources)
    lines.push(`- [${source.label}](${source.url})`);
  return lines.join("\n").trimEnd();
}

export function roundupMarkdown(level = 1): string {
  const h = (n: number) => "#".repeat(level + n - 1);
  const lines = [
    `${h(1)} ${ROUNDUP_TITLE}`,
    "",
    `Source: ${SITE_URL}${ROUNDUP_PATH}. ${ROUNDUP_DESCRIPTION}`,
    "",
    markdownText(ROUNDUP_VERDICT),
    "",
    markdownText(ROUNDUP_DISCLOSURE),
    "",
    `${h(2)} The tools`,
    "",
    "| Tool | Best for | Reads the code | Price |",
    "| --- | --- | --- | --- |",
    ...ROUNDUP_TOOLS.map(
      (tool) =>
        `| [${tool.name}](${absolute(tool.href)}) | ${cell(tool.bestFor)} | ${cell(tool.readsCode)} | ${cell(tool.price)} |`,
    ),
    "",
  ];
  for (const tool of ROUNDUP_TOOLS) {
    lines.push(
      `${h(3)} ${tool.name}`,
      "",
      `Best for: ${guidePlainText(tool.bestFor)}.`,
      "",
      markdownText(tool.text),
      "",
    );
    if (tool.compare)
      lines.push(`Comparison: ${SITE_URL}${comparePath(tool.compare)}`, "");
  }
  lines.push(`${h(2)} Also worth knowing`, "");
  for (const note of ROUNDUP_NOTES) lines.push(`- ${markdownText(note)}`);
  lines.push("", `${h(2)} Questions`, "");
  for (const { question, answer } of ROUNDUP_QUESTIONS)
    lines.push(`${h(3)} ${question}`, "", markdownText(answer), "");
  lines.push(`${h(2)} Sources (checked ${COMPARE_CHECKED})`, "");
  for (const source of [
    ...ROUNDUP_SOURCES,
    ...COMPARE_PAGES.map((page) => ({
      label: `GitDiagram vs ${page.tool} (with its sources)`,
      url: `${SITE_URL}${comparePath(page.slug)}`,
    })),
  ])
    lines.push(`- [${source.label}](${source.url})`);
  return lines.join("\n").trimEnd();
}
