import { SITE_URL } from "~/lib/site";
import {
  SITUATIONS_CHECKED,
  diagramPicturePath,
  situationPath,
  type SituationPage,
} from "./content";

// A situation guide as Markdown: /guides/{slug}.md (the proxy rewrites it to
// ./llms.txt like a repository's twin) and the end of /llms-full.txt.

function absolute(href: string): string {
  return href.startsWith("/") ? `${SITE_URL}${href}` : href;
}

function markdownText(text: string): string {
  return text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label: string, href: string) => `[${label}](${absolute(href)})`,
  );
}

function codeBlock(code: { caption: string; text: string }): string[] {
  // A block that itself contains ``` fences needs a longer fence.
  const fence = code.text.includes("```") ? "````" : "```";
  return [`${code.caption}:`, "", fence, code.text, fence, ""];
}

export function situationMarkdown(page: SituationPage, level = 1): string {
  const h = (n: number) => "#".repeat(level + n - 1);
  const { example } = page;
  const lines = [
    `${h(1)} ${page.title}`,
    "",
    `Source: ${SITE_URL}${situationPath(page.slug)}. Written by GitDiagram; checked ${SITUATIONS_CHECKED}.`,
    "",
    markdownText(page.answer),
    "",
    `${h(2)} ${page.stepsHeading}`,
    "",
    ...page.steps.map(
      (step, index) =>
        `${index + 1}. **${step.name}.** ${markdownText(step.text)}`,
    ),
    "",
    `${h(2)} ${example.heading}`,
    "",
    `![Architecture diagram of ${example.repo}](${SITE_URL}${diagramPicturePath(example.repo)})`,
    "",
    `Interactive diagram: ${SITE_URL}/${example.repo}`,
    "",
  ];
  for (const paragraph of example.paragraphs)
    lines.push(markdownText(paragraph), "");
  if (example.code) lines.push(...codeBlock(example.code));
  for (const section of page.sections) {
    lines.push(`${h(2)} ${section.heading}`, "");
    for (const paragraph of section.paragraphs)
      lines.push(markdownText(paragraph), "");
    if (section.code) lines.push(...codeBlock(section.code));
  }
  if (page.questions.length) {
    lines.push(`${h(2)} Questions`, "");
    for (const { question, answer } of page.questions)
      lines.push(`${h(3)} ${question}`, "", markdownText(answer), "");
  }
  lines.push(`${h(2)} Sources (checked ${SITUATIONS_CHECKED})`, "");
  for (const source of page.sources)
    lines.push(`- [${source.label}](${source.url})`);
  return lines.join("\n").trimEnd();
}
