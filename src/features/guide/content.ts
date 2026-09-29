import { GITHUB_REPO_URL, SITE_URL } from "~/lib/site";

// The /visualize-codebase guide, written once and rendered three ways: the
// page (HTML), /llms-full.txt (Markdown) and the page's FAQPage JSON-LD.
// Text uses two inline marks only: [label](href) links and `code`. Links
// starting with "/" are this site's pages.

export const GUIDE_PATH = "/visualize-codebase";
export const GUIDE_TITLE =
  "How to visualize a codebase: an architecture diagram of any GitHub repo";
export const GUIDE_DESCRIPTION =
  "Get an interactive architecture diagram of any GitHub repository in one step, see what it shows, use it from AI agents, and compare it honestly with DeepWiki, Sourcegraph, IDE graphs and Claude Code.";
export const GUIDE_UPDATED = "2026-09-29";

export interface GuideSection {
  id: string;
  heading: string;
  paragraphs: string[];
  /** Named entries, each with its text (the comparison list). */
  entries?: Array<{ name: string; text: string }>;
}

export interface GuideQuestion {
  question: string;
  answer: string;
}

export const GUIDE_INTRODUCTION =
  "The quickest way to understand an unfamiliar repository is a picture of its main parts and how they connect. This guide shows how to get one for any GitHub repository in one step, what it contains, how AI agents can use it, and when a different tool is the better choice.";

export function guideSections({ videos }: { videos: boolean }): GuideSection[] {
  return [
    {
      id: "one-step",
      heading: "Get a diagram in one step",
      paragraphs: [
        "Replace `hub` with `diagram` in the repository's GitHub URL: `https://github.com/fastapi/fastapi` becomes [gitdiagram.com/fastapi/fastapi](/fastapi/fastapi). You can also paste a GitHub URL, or just `owner/repo`, on the [home page](/). File, branch, issue and pull request URLs work too; they open the repository's diagram.",
        "If the repository has been diagrammed before, the stored diagram opens at once. Otherwise GitDiagram makes one, usually in about a minute, and keeps it so the next person gets it instantly. Some to try: [FastAPI](/fastapi/fastapi), [Flask](/pallets/flask), [React](/facebook/react) and [Next.js](/vercel/next.js). [Browse](/browse) lists every stored diagram.",
      ],
    },
    {
      id: "what-it-shows",
      heading: "What the diagram shows",
      paragraphs: [
        "An AI model reads the repository's file tree, its README and up to 12 of its source files. It writes a short explanation of the architecture, then a graph of the main components (at most 34), grouped into areas, with labeled connections between them. Every file path in the graph is checked against the real repository before the graph is compiled into a [Mermaid](https://mermaid.js.org) flowchart.",
        "Click a component to open its file or folder on GitHub. Info shows the written overview, Enable zoom lets you pan and zoom, and Export downloads a PNG or copies the Mermaid code for your own docs. Each repository page also lists its components and connections as text below the diagram.",
        "It is a map of the important parts, not a complete dependency graph. It can simplify or leave things out, and it shows the repository as it was when the diagram was made; Regenerate makes a fresh one.",
      ],
    },
    {
      id: "private-repositories",
      heading: "Private repositories",
      paragraphs: [
        "Choose Private Repos in the header and paste a fine-grained GitHub personal access token that can read the repositories you want. The token stays in a secure cookie in your browser and is sent only with your own requests; it is never saved on GitDiagram's servers. Diagrams of private repositories are stored separately, where only that token can reach them. The [privacy policy](/privacy) has the details.",
        "Making diagrams is free within a daily limit. If it runs out, you can add your own OpenAI API key under API Key.",
      ],
    },
    ...(videos
      ? [
          {
            id: "videos",
            heading: "Explainer videos",
            paragraphs: [
              "Many repositories also have a narrated video tour of about a minute: what the project is for, what people do with it, and how its main parts fit together. Open it with the Video button on a repository's page, or watch them all on [the videos page](/videos) or as [reels](/reels). Free videos are limited each day; past the limit, you can pay $3 to have one made.",
            ],
          },
        ]
      : []),
    {
      id: "ai-agents",
      heading: "Use it from AI agents",
      paragraphs: [
        "Every stored diagram has a Markdown version for agents: add `.md` to the page URL, as in [gitdiagram.com/fastapi/fastapi.md](/fastapi/fastapi.md), or request the page with the header `Accept: text/markdown`. It holds the overview, the Mermaid source, every component with its GitHub link, and the connections. For a repository without a diagram yet, it says how to make one.",
        "Agents that speak the Model Context Protocol can connect to the read-only server at `https://gitdiagram.com/mcp` (streamable HTTP), for example to call `get_diagram` with an owner and a repository name.",
        "[llms.txt](/llms.txt) sums this up for language models, and [llms-full.txt](/llms-full.txt) holds this whole guide. An agent helping someone understand a repository can read the `.md` version itself and give the person the interactive link, `https://gitdiagram.com/{owner}/{repo}`.",
      ],
    },
    {
      id: "alternatives",
      heading: "Other ways to visualize a codebase",
      paragraphs: [
        "GitDiagram is built for one job: a single picture of a whole repository, with no setup. Other tools do other jobs better:",
      ],
      entries: [
        {
          name: "DeepWiki",
          text: "Replace `github` with `deepwiki` in a repository URL to get a generated wiki: many pages of documentation with diagrams, and a chat that answers questions about the code. Better when you want to read about a project in depth or ask it questions. GitDiagram is better when you want the whole system on one screen, each part linked to its code.",
        },
        {
          name: "Claude Code, Codex or another coding agent",
          text: "Ask the agent in your own checkout to draw a Mermaid diagram. It can read every file, including uncommitted work and private code that never leaves your machine, and draw exactly the view you ask for: one feature, one request path, a sequence diagram. Better for a focused question or code that isn't on GitHub. GitDiagram is better when you want a diagram without cloning anything, a link you can share, or a quick overview before you open the code.",
        },
        {
          name: "Sourcegraph",
          text: "Code search and navigation across many repositories, with precise go-to-definition and find-references. Better when you need exact answers, such as every caller of a function. It does not draw an architecture overview.",
        },
        {
          name: "IDE and language dependency graphs",
          text: "JetBrains IDEs, and tools such as `madge` for JavaScript or `pydeps` for Python, draw graphs straight from the imports. Better when you need an exact and complete module graph. They show every import rather than the parts that matter, so graphs of large projects get hard to read.",
        },
        {
          name: "Drawing it yourself",
          text: "Writing a Mermaid, PlantUML or draw.io diagram by hand gives full control, and GitHub renders Mermaid inside Markdown files. Better for a diagram you maintain in your own docs. Exporting GitDiagram's Mermaid code is a quick first draft to edit.",
        },
      ],
    },
  ];
}

export const GUIDE_QUESTIONS: GuideQuestion[] = [
  {
    question: "How do I get an architecture diagram of a GitHub repository?",
    answer:
      "Replace `hub` with `diagram` in its URL, for example `https://gitdiagram.com/pallets/flask`. The diagram opens in your browser, with nothing to install.",
  },
  {
    question: "Is GitDiagram free?",
    answer: `Yes. Opening stored diagrams is free, and making new ones is free within a daily limit; after that you can use your own OpenAI API key. GitDiagram is also [open source](${GITHUB_REPO_URL}).`,
  },
  {
    question: "Does it work with private repositories?",
    answer:
      "Yes, with a GitHub token that can read them. The token stays in your browser, and the diagram is stored where only that token can reach it.",
  },
  {
    question: "How accurate is the diagram?",
    answer:
      "It is made by AI from the file tree, the README and a sample of source files, and every linked path is checked against the real repository. Treat it as a reliable map of the main parts, and confirm details in the code.",
  },
  {
    question: "Can I put the diagram in my README or docs?",
    answer:
      "Yes. Export a PNG, or copy the Mermaid code: GitHub renders Mermaid in Markdown files.",
  },
  {
    question: "Can AI assistants use GitDiagram?",
    answer:
      "Yes. They can read `https://gitdiagram.com/{owner}/{repo}.md`, or connect to the MCP server at `https://gitdiagram.com/mcp`.",
  },
  {
    question: "How is it different from DeepWiki?",
    answer:
      "DeepWiki writes a multi-page wiki with a chat; GitDiagram gives one interactive diagram of the whole system, with each part linked to its code. They work well together.",
  },
];

/** A link's absolute URL (site paths get the site's origin). */
function absoluteHref(href: string): string {
  return href.startsWith("/") ? `${SITE_URL}${href}` : href;
}

/** Guide text as plain text: links keep their label, code its content. */
export function guidePlainText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/** Guide text as Markdown with absolute links. */
function guideMarkdownText(text: string): string {
  return text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label: string, href: string) => `[${label}](${absoluteHref(href)})`,
  );
}

/** The whole guide as Markdown (the body of /llms-full.txt). */
export function guideMarkdown({ videos }: { videos: boolean }): string {
  const lines = [
    `## ${GUIDE_TITLE}`,
    "",
    `Source: ${SITE_URL}${GUIDE_PATH} (updated ${GUIDE_UPDATED})`,
    "",
    guideMarkdownText(GUIDE_INTRODUCTION),
    "",
  ];
  for (const section of guideSections({ videos })) {
    lines.push(`### ${section.heading}`, "");
    for (const paragraph of section.paragraphs)
      lines.push(guideMarkdownText(paragraph), "");
    for (const entry of section.entries ?? [])
      lines.push(`- **${entry.name}**: ${guideMarkdownText(entry.text)}`);
    if (section.entries?.length) lines.push("");
  }
  lines.push("### Questions", "");
  for (const { question, answer } of GUIDE_QUESTIONS) {
    lines.push(`#### ${question}`, "", guideMarkdownText(answer), "");
  }
  return lines.join("\n").trimEnd();
}
