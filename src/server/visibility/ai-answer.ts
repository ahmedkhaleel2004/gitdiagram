// Reads an assistant's answer for what the AI-visibility run measures: does it
// name GitDiagram, link to gitdiagram.com, and where does GitDiagram come among
// the tools it names. Pure functions, so they are tested on real answers.

/** The fixed questions, phrased the way people ask them. Ids are stable: history is keyed by them. */
export const AI_VISIBILITY_PROMPTS: ReadonlyArray<{
  id: string;
  text: string;
}> = [
  {
    id: "visualize-architecture",
    text: "How can I visualize the architecture of my codebase?",
  },
  {
    id: "diagram-from-github-repo",
    text: "Is there a tool that generates an architecture diagram from a GitHub repo?",
  },
  {
    id: "understand-large-repo",
    text: "How do I understand a large unfamiliar GitHub repository quickly?",
  },
  {
    id: "best-codebase-visualizers",
    text: "What are the best tools to visualize a codebase?",
  },
  {
    id: "diagram-of-github-repo",
    text: "Generate a diagram of a GitHub repository",
  },
  {
    id: "system-design-from-code",
    text: "How can I create a system design diagram from code?",
  },
  {
    id: "onboard-new-codebase",
    text: "I just joined a team with a huge codebase. What tools help me get an overview of how it's structured?",
  },
  {
    id: "repo-to-mermaid",
    text: "Is there a way to turn a GitHub repo into a Mermaid diagram automatically?",
  },
  {
    id: "ai-explain-repo",
    text: "What AI tools can explain how a GitHub project works?",
  },
  {
    id: "readme-architecture-diagram",
    text: "How do I add an architecture diagram to my project's README without drawing it by hand?",
  },
  {
    id: "free-repo-visualizer",
    text: "Free online tool to visualize a GitHub repo's structure",
  },
  {
    id: "map-open-source-project",
    text: "I want to contribute to an open source project. How can I see a map of its components before reading the code?",
  },
];

const GITDIAGRAM = /\bgit[ -]?diagram(?:\.com)?\b/i;

// Tools an answer may name, matched by these patterns (first is the display name).
const KNOWN_TOOLS: Array<[name: string, pattern: RegExp]> = [
  ["GitDiagram", GITDIAGRAM],
  ["DeepWiki", /\bdeep ?wiki\b/i],
  ["Sourcegraph", /\bsourcegraph\b/i],
  ["CodeSee", /\bcodesee\b/i],
  ["Swimm", /\bswimm\b/i],
  ["Mermaid", /\bmermaid(?:\.js)?\b/i],
  ["PlantUML", /\bplant ?uml\b/i],
  ["Structurizr", /\bstructurizr\b/i],
  ["CodeViz", /\bcode ?viz\b/i],
  ["Repomix", /\brepomix\b/i],
  ["GitUML", /\bgit ?uml\b/i],
  ["Gitingest", /\bgit ?ingest\b/i],
  ["Swark", /\bswark\b/i],
  ["Eraser", /\beraser(?:\.io)?\b|\bdiagramgpt\b|\bgit diagrammer\b/i],
  ["Madge", /\bmadge\b/i],
  ["dependency-cruiser", /\bdependency[- ]cruiser\b/i],
  ["pydeps", /\bpydeps\b/i],
  ["Pyreverse", /\bpyreverse\b/i],
  ["Doxygen", /\bdoxygen\b/i],
  ["Graphviz", /\bgraphviz\b/i],
  ["CodeScene", /\bcodescene\b/i],
  ["SonarQube", /\bsonarqube\b/i],
  ["Sourcetrail", /\bsourcetrail\b/i],
  ["Understand", /\bscitools\b|\bunderstand by scitools\b/i],
  ["NDepend", /\bndepend\b/i],
  ["Structure101", /\bstructure101\b/i],
  ["CodeCharta", /\bcodecharta\b/i],
  ["Gource", /\bgource\b/i],
  ["code2flow", /\bcode2flow\b/i],
  ["Diagrams (mingrammer)", /\bmingrammer\b/i],
  ["D2", /\bD2\b(?![- ]?(?:diagram )?language\b)/],
  ["IcePanel", /\bicepanel\b/i],
  ["Lucidchart", /\blucid ?chart\b/i],
  ["draw.io", /\bdraw\.io\b|\bdiagrams\.net\b/i],
  ["Excalidraw", /\bexcalidraw\b/i],
  ["Greptile", /\bgreptile\b/i],
  ["GitHub Copilot", /\b(?:github )?copilot\b/i],
  ["Cursor", /\bCursor\b/],
  ["Claude Code", /\bclaude code\b/i],
  ["Codex", /\bcodex\b/i],
  ["ChatGPT", /\bchatgpt\b/i],
  ["Codeium", /\bcodeium\b|\bwindsurf\b/i],
  ["Code Wiki", /\bcode ?wiki\b/i],
  ["CodeRabbit", /\bcoderabbit\b/i],
  ["Bloop", /\bbloop\b/i],
  ["Onboard AI", /\bonboard ai\b/i],
  ["Mintlify", /\bmintlify\b/i],
  ["GitKraken", /\bgitkraken\b/i],
  ["Octotree", /\boctotree\b/i],
  ["repo-visualizer", /\brepo[- ]visualizer\b/i],
  ["CodeFlow", /\bcodeflow\b/i],
  ["AppMap", /\bappmap\b/i],
];

// A bolded name leading a list item: "- **Name**", "1. **Name** –". Catches
// tools the list above does not know. Headings and "**Label:**" items are
// section titles, so they are left out.
const LEADING_NAME = /^\s*(?:[-*+]|\d+[.)])\s+\*\*([^*\n:]{2,40})\*\*/gm;

/** A bolded phrase that reads like a product name, not a label. */
function cleanName(raw: string): string | null {
  const name = raw
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[\s\u2013\u2014-]+$/, "")
    .trim();
  const words = name.split(/\s+/);
  if (
    !name ||
    words.length > 4 ||
    !/^[A-Z0-9]/.test(name) ||
    /[/\u2192,;&]/.test(name) ||
    /^(?:a|an|the|for|if|to|use|try|your|my|with|without|best|other|option|step|tip)\b/i.test(
      name,
    )
  )
    return null;
  // Branded (CodeSee, draw.io, D2, code2flow) or Title Case ("Visual Studio
  // Code Maps"). A lone ordinary word ("Architecture") is a label.
  const branded = /[a-z][A-Z]|\d|\.|-/.test(name);
  const titleCase =
    words.length > 1 && words.every((word) => /^[A-Z0-9]/.test(word));
  return branded || titleCase ? name : null;
}

function knownName(text: string): string | null {
  for (const [name, pattern] of KNOWN_TOOLS)
    if (pattern.test(text)) return name;
  return null;
}

/** The tools an answer names, in the order it first names them. */
export function toolsNamed(text: string): string[] {
  const found = new Map<string, number>();
  const note = (name: string, index: number) => {
    const key = name.toLowerCase();
    const seen = found.get(key);
    if (seen === undefined || index < seen) found.set(key, index);
  };
  const display = new Map<string, string>();
  for (const [name, pattern] of KNOWN_TOOLS) {
    const match = pattern.exec(text);
    if (match) {
      note(name, match.index);
      display.set(name.toLowerCase(), name);
    }
  }
  for (const match of text.matchAll(LEADING_NAME)) {
    const raw = match[1];
    if (!raw) continue;
    const name = knownName(raw) ?? cleanName(raw);
    if (!name) continue;
    note(name, match.index);
    if (!display.has(name.toLowerCase())) display.set(name.toLowerCase(), name);
  }
  return [...found.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => display.get(key)!);
}

const URL_IN_TEXT = /https?:\/\/[^\s)\]>"'`]+/g;

function isGitDiagramSite(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "gitdiagram.com" || host.endsWith(".gitdiagram.com");
  } catch {
    return false;
  }
}

export interface AnswerReading {
  mentioned: boolean;
  cited: boolean;
  inSources: boolean;
  position: number | null;
  tools: string[];
}

/**
 * What an answer says about GitDiagram. `citations` are the URLs the answer
 * cites; `sources` every page its search returned.
 */
export function readAnswer(
  text: string,
  citations: string[] = [],
  sources: string[] = [],
): AnswerReading {
  const tools = toolsNamed(text);
  const index = tools.indexOf("GitDiagram");
  const linked = [...citations, ...(text.match(URL_IN_TEXT) ?? [])];
  const cited = linked.some(isGitDiagramSite);
  return {
    mentioned: index >= 0 || cited || GITDIAGRAM.test(text),
    cited,
    inSources: [...sources, ...citations].some(isGitDiagramSite),
    position: index >= 0 ? index + 1 : null,
    tools,
  };
}
