// Diagrams made before about March 2026 stored the first model's notes to the
// diagram drawer as their "explanation": wrapped in literal <explanation>
// tags and written as a guide for drawing ("Based on the provided file tree
// and README, I'll explain how to create a system design diagram…", "Color
// Coding", "Diagramming Guidelines", a Mermaid snippet). The facts about the
// repository sit in between. This keeps the facts and drops the drawing
// instructions, at read time: stored data is never rewritten.
//
// Only text that still carries the <explanation> tag is touched. Current
// explanations never do (the server strips it before saving), so they pass
// through unchanged.

import { architectureText } from "./architecture-text";

const TAG = /<\/?explanation\s*>/gi;

/** A section heading line: "1. Title", "2) Title", "#### 3) Title", "### Title", "A. Title:". */
const HEADING =
  /^(?:#{1,6}\s+)?(?:\*\*)?(?:(?:\d{1,2}|[A-Z])[.)]\s+)?(?<title>[^\n]{2,90}?)(?:\*\*)?:?\s*$/;
const NUMBERED_OR_HASH = /^(?:#{1,6}\s+|(?:\*\*)?\d{1,2}[.)]\s+)/;

// Sections about how to draw, not about the repository.
const INSTRUCTION_SECTION =
  /\b(?:guidelines?|colou?r|legend|visual|layout|tailor(?:ed|ing)?|tips?|emphas[ie]s|best practices?|considerations|example|snippet|mermaid|how to (?:create|draw|build|structure|interpret)|draw(?:ing)?|diagram(?:ming)? (?:structure|elements?|creation|organi[sz]ation|style|design|layout|approach|notes?|checklist)|structure (?:the|your|of the) diagram|completeness|final (?:notes?|checks?|tips?|thoughts)|key (?:diagram )?elements to include|instructions?|presentation|styling|formatting|accuracy|remember|summary for the|deliverable|abstraction level|level of detail|annotations?|notation|shapes?)\b|^what to (?:put|show|include)$/i;

// Lines that talk to the person drawing.
const INSTRUCTION_LINE =
  /\b(?:diagrams?|arrows?|boxes|box|colou?r(?:s|ed|-coded|-code| code| coding)?|legend|swim ?lanes?|subgraphs?|mermaid|principal engineer|draw|depict|visuali[sz]e|label (?:each|the|all)|place (?:the|it|them|each)|nodes? and edges|icons?|shapes?|cylinders?|dashed|dotted|solid lines?|top-to-bottom|left-to-right|layers? (?:at|on) the (?:top|bottom))\b|\byou(?:'ll|’ll| will| should| can)\b|\bI(?:'ll|’ll| will)\b|\binstruct\b|\bif you\b|^label\b|\b(?:sub-?)?label(?:ed)? (?:it |this (?:component |box |node )?|them )?as\b|\blabel this\b|^create (?:a|an|the|detailed|separate)\b/i;

// Opening and closing sentences of the guide.
const GUIDE_FRAME =
  /^(?:(?:first|next|then|finally|now),? (?:establish|break|define|add|create|show|identify|map|group|lay|list|outline)|break (?:down|it)|establish |start (?:by|with) |begin (?:by|with) |based on (?:the|this|my) |below is |here(?:'s|’s| is) (?:how|a|the)|this (?:guide|explanation)|to (?:create|draw|build) |by following|remember[:,]|in summary|overall,? (?:the|this) diagram|following these|the (?:final |resulting |system )?diagram should|this should (?:give|provide|result)|let me know)/i;

const MERMAID_FENCE = /^\s*(?:```|~~~)/;

// "Show Publisher and Subscriber components" → "Publisher and Subscriber
// components": the order to the drawer goes, the fact stays.
const IMPERATIVE =
  /^(?:(?:also|then|optionally|clearly)\s+)?(?:show(?:case)?|include|display|place|connect|analy[sz]e|examine|describe|determine|define|clarify|explain|add|highlight|indicate|represent|group|mark|position|organi[sz]e|arrange|put|ensure|make sure|consider|focus on|start with|begin with|annotate|emphasi[sz]e|illustrate|map|list|capture|reflect|outline|identify|note)\b[\s:,]*(?:(?:these|the|all|any|each|its|key)\s+)?/i;

function dropImperative(line: string): string {
  const match = /^(\s*(?:[-•*]|\d{1,2}[.)]|[a-z][.)])?\s*)(.*)$/.exec(line);
  if (!match) return line;
  const [, lead = "", body = ""] = match;
  const rest = body.replace(IMPERATIVE, "");
  if (rest === body || rest.length < 3) return line;
  return `${lead}${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}

/** Plain text of a line, for measuring what is left. */
const plain = (line: string) =>
  line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/[*`]/g, "")
    .replace(/^[-•]\s+/, "")
    .trim();

/** The smallest amount of prose worth showing, in characters. */
const MIN_USEFUL_CHARS = 160;

function isLegacyExplanation(text: string): boolean {
  return /<\/?explanation\s*>/i.test(text);
}

function headingTitle(line: string): string | null {
  const trimmed = line.trim();
  if (!NUMBERED_OR_HASH.test(trimmed)) return null;
  const match = HEADING.exec(trimmed);
  return match?.groups?.title?.trim() ?? null;
}

/** "Key Components to Include in the Diagram" → "Key Components". */
function tidyTitle(title: string): string {
  return dropImperative(title)
    .replace(/\*\*/g, "")
    .replace(
      /\s*(?:to (?:include|show|represent)|for|in|of) (?:the |your |a |this )?(?:system[- ]design |architecture |system )?diagram\b.*$/i,
      "",
    )
    .replace(/\s*\((?:for|in) the diagram\)/i, "")
    .replace(/\s+to (?:include|show|represent)$/i, "")
    .replace(/[:\s]+$/, "")
    .trim();
}

/**
 * The repository facts of a legacy explanation, as the same small Markdown
 * subset (### headings, "- " bullets). Empty when too little is left to be
 * worth showing: nothing is better than drawing instructions.
 */
export function cleanLegacyExplanation(text: string): string {
  if (!isLegacyExplanation(text)) return text;
  const lines = text.replace(TAG, "\n").split("\n");
  const kept: string[] = [];
  let skippingSection = false;
  // "mermaid" (a drawing, dropped) or "text" (a tree of names, kept).
  let fence: "mermaid" | "text" | null = null;
  let sectionDepth = 0;

  for (const raw of lines) {
    let line = raw.replace(/\s+$/, "");
    if (MERMAID_FENCE.test(line)) {
      fence = fence
        ? null
        : /mermaid|graph|flowchart/i.test(line)
          ? "mermaid"
          : "text";
      continue;
    }
    if (fence === "mermaid") continue;
    if (fence === "text") {
      // "├── Redis Cache" → "- Redis Cache"; a bare line is a group name.
      if (
        /^\s*(?:graph|flowchart|subgraph|end$|sequenceDiagram|classDiagram)\b/.test(
          line,
        )
      )
        continue;
      const item = line.replace(/^[\s│├└─|`+\\-]+/, "").trim();
      if (!item) {
        kept.push("");
        continue;
      }
      line = /^[\s│├└─|`+\\-]/.test(line) ? `- ${item}` : `**${item}**`;
      if (INSTRUCTION_LINE.test(plain(line))) continue;
      kept.push(line);
      continue;
    }
    if (!line.trim() || /^-{3,}$/.test(line.trim())) {
      kept.push("");
      continue;
    }

    // Only top-level headings (no indentation) open a new section.
    const indent = raw.length - raw.trimStart().length;
    const title = indent === 0 ? headingTitle(line) : null;
    if (title) {
      const depth = /^#{1,6}/.exec(line.trim())?.[0].length ?? 0;
      // A sub-heading inside a skipped section stays skipped.
      if (skippingSection && depth > sectionDepth && depth > 0) continue;
      skippingSection = INSTRUCTION_SECTION.test(title);
      sectionDepth = depth;
      if (skippingSection) continue;
      const tidy = tidyTitle(title);
      if (tidy.length >= 3 && !INSTRUCTION_LINE.test(tidy))
        kept.push(`### ${tidy}`);
      continue;
    }
    if (skippingSection) continue;
    const text = plain(line);
    if (GUIDE_FRAME.test(text) || INSTRUCTION_LINE.test(text)) continue;
    kept.push(dropImperative(line.trim()).replace(/^[•*]\s+/, "- "));
  }

  // Drop headings left without any text under them, then blank runs.
  const out: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const line = kept[i]!;
    if (line.startsWith("### ")) {
      const next = kept.slice(i + 1).find((l) => l.trim());
      if (!next || next.startsWith("### ")) continue;
    }
    out.push(line);
  }
  const cleaned = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const prose = cleaned
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("### "))
    .map(plain)
    .join(" ");
  return prose.length >= MIN_USEFUL_CHARS ? cleaned : "";
}

/**
 * A stored explanation as every reader shows it (page readout, Markdown
 * twin, meta description, JSON-LD, MCP, the activity panel): old HTML turned
 * into the Markdown subset, and old drawing guides cut down to their facts.
 */
export function storedExplanationText(text: string): string {
  return cleanLegacyExplanation(architectureText(text));
}
