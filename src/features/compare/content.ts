import type { GuideQuestion } from "~/features/guide/content";

// Comparison pages: GitDiagram next to one other tool (/compare/{slug}) and a
// roundup of them all (ROUNDUP_PATH). Written by GitDiagram, checked against
// each tool's own docs on COMPARE_CHECKED; every claim about another tool has
// a source in `sources`. Text uses the guide's two inline marks: [label](href)
// links and `code`. Rendered as HTML, as Markdown (/compare/{slug}.md and
// /llms-full.txt) and as Article + FAQPage JSON-LD.

/** When every fact on these pages was last checked. Change only after rechecking. */
export const COMPARE_CHECKED = "2026-11-09";
export const ROUNDUP_PATH = "/best-codebase-visualization-tools";

export interface CompareSource {
  label: string;
  url: string;
}

interface CompareSection {
  id: string;
  heading: string;
  paragraphs: string[];
  /** A verbatim block (command output, code), shown as preformatted text. */
  code?: { caption: string; text: string };
}

interface CompareFact {
  label: string;
  gitdiagram: string;
  other: string;
}

export interface ComparePage {
  slug: string;
  /** The other tool's name. */
  tool: string;
  /** The page's heading (h1). */
  title: string;
  /** The <title>: at most 60 characters, to fit a search result. */
  metaTitle: string;
  description: string;
  /** The answer first: one paragraph. */
  verdict: string;
  chooseOther: string[];
  chooseGitDiagram: string[];
  sections: CompareSection[];
  facts: CompareFact[];
  questions: GuideQuestion[];
  sources: CompareSource[];
}

export function comparePath(slug: string): string {
  return `/compare/${slug}`;
}

// What GitDiagram is, said the same way on every page.
const GD = {
  output:
    "One interactive architecture diagram: up to 34 main components in groups, with labeled connections and a written overview. Each component links to its file or folder on GitHub.",
  setup:
    "None. Replace `hub` with `diagram` in a GitHub URL, or paste the URL on the [home page](/).",
  readsCode:
    "Yes. An AI model reads the file tree, the README and up to 12 source files; every linked path is checked against the real repository.",
  private:
    "Yes, with a fine-grained GitHub token that stays in your browser and is never saved on GitDiagram's servers.",
  price:
    "Free. Making new diagrams is free within a shared daily limit; after that you can add your own OpenAI API key.",
  openSource:
    "Yes, MIT ([source](https://github.com/ahmedkhaleel2004/gitdiagram)).",
  agents:
    "Markdown at `gitdiagram.com/{owner}/{repo}.md` and a free MCP server at `https://gitdiagram.com/mcp`, no sign-in.",
};

const GD_LIMITS =
  "GitDiagram's limits: it is a map of the important parts, not a complete dependency graph. It can simplify or leave things out, it works only with GitHub repositories, and it shows the repository as it was when the diagram was made (Regenerate makes a fresh one).";

const EXPRESS_COMMIT = "43fca52";

export const COMPARE_PAGES: ComparePage[] = [
  {
    slug: "deepwiki",
    tool: "DeepWiki",
    title: "GitDiagram vs DeepWiki: one diagram or a whole wiki",
    metaTitle: "GitDiagram vs DeepWiki: Diagram or Wiki?",
    description:
      "DeepWiki writes a multi-page wiki with a chat; GitDiagram draws one interactive architecture diagram. An honest comparison on the same repository, with pricing, private repos and MCP.",
    verdict:
      "DeepWiki and GitDiagram both start from a public GitHub URL and need nothing installed, but they make different things. DeepWiki writes a wiki about the repository: dozens of pages of explanation with many diagrams, plus a chat (Ask Devin) that answers questions. GitDiagram draws one interactive diagram of the whole repository, with every part linked to its code. Choose DeepWiki to read about a project in depth or ask it questions; choose GitDiagram for the whole system on one screen, a link to share, or Mermaid code for your README. They work well together.",
    chooseOther: [
      "You want written explanations of each part of the project.",
      "You want to ask questions about the code in a chat.",
      "You want sequence or class diagrams of specific flows.",
      "Your team already uses Devin and wants wikis of its private repositories.",
    ],
    chooseGitDiagram: [
      "You want the whole architecture on one screen in a few seconds.",
      "You want to click a part and land on its file or folder on GitHub.",
      "You want Mermaid code or a PNG to put in your own docs.",
      "You want a private repository's diagram without signing up for anything.",
      "You want a tool that is open source.",
    ],
    sections: [
      {
        id: "same-repository",
        heading: "The same repository in both",
        paragraphs: [
          "For Express ([expressjs/express](https://github.com/expressjs/express)), [DeepWiki's wiki](https://deepwiki.com/expressjs/express) has 33 pages in 9 sections, about 40,000 words, with 151 Mermaid diagrams (flowcharts, sequence diagrams and class diagrams). We counted them on 2026-11-09 through DeepWiki's own MCP server (`read_wiki_structure` and `read_wiki_contents`). Its FastAPI wiki has 56 pages.",
          '[GitDiagram\'s Express diagram](/expressjs/express) is one picture: 16 components in 5 groups (Application Entry, Routing Pipeline, HTTP Semantics, Rendering Delivery, Framework Internals) with 21 labeled connections, such as Express Application to Router Integration, "dispatches request". A one-paragraph overview sits above it, and the page lists every component and connection as text.',
          'So DeepWiki answers "how does each part work?", and GitDiagram answers "what are the parts and how do they connect?".',
        ],
      },
      {
        id: "deepwiki",
        heading: "What DeepWiki does",
        paragraphs: [
          "DeepWiki, made by Cognition (the company behind Devin), indexes a repository and produces a wiki with architecture diagrams, links to sources and summaries. Replace `github.com` with `deepwiki.com` in a repository URL; Cognition says more than 50,000 popular public repositories are already indexed, and any other public repository can be added for free.",
          "It is the free public version of Devin's own wiki and search. Private repositories need a Devin account. A `.devin/wiki.json` file in a repository can steer what the wiki covers, and DeepWiki's docs note that on large repositories its automatic page planning can leave out some folders.",
          "For agents, DeepWiki runs a free MCP server at `https://mcp.deepwiki.com/mcp` with no sign-in, for public repositories, with the tools `read_wiki_structure`, `read_wiki_contents` and `ask_question`.",
        ],
      },
      {
        id: "gitdiagram",
        heading: "What GitDiagram does",
        paragraphs: [
          "Replace `hub` with `diagram` in a GitHub URL. A stored diagram opens at once; otherwise one is made in about a minute and kept for the next visitor. You can pan and zoom, read the overview, export a PNG or copy the Mermaid code.",
          GD_LIMITS,
        ],
      },
    ],
    facts: [
      {
        label: "What you get",
        gitdiagram: GD.output,
        other:
          "A multi-page wiki with diagrams and source links, and a chat that answers questions about the code.",
      },
      {
        label: "Setup",
        gitdiagram: GD.setup,
        other:
          "None for public repositories: replace `github.com` with `deepwiki.com`.",
      },
      {
        label: "Private repositories",
        gitdiagram: GD.private,
        other: "Yes, through a Devin account with the repository connected.",
      },
      {
        label: "Price",
        gitdiagram: GD.price,
        other:
          "Free for public repositories. Devin plans are listed at $0 (Free), $20 a month (Pro), $200 a month (Max) and $80 a month plus $40 per seat (Teams).",
      },
      {
        label: "Open source",
        gitdiagram: GD.openSource,
        other: "Not that we found: it is a hosted Cognition product.",
      },
      {
        label: "For AI agents",
        gitdiagram: GD.agents,
        other:
          "A free MCP server at `https://mcp.deepwiki.com/mcp`, no sign-in.",
      },
    ],
    questions: [
      {
        question: "Is DeepWiki free?",
        answer:
          "Yes for public repositories: reading wikis and asking questions needs no account. Wikis of private repositories come with a Devin account; Devin has a free plan and paid plans from $20 a month.",
      },
      {
        question: "Which is better for understanding a new repository?",
        answer:
          "Start with GitDiagram to see the main parts and how they connect, then read DeepWiki's pages or ask its chat about the parts you care about. The diagram takes seconds to read; the wiki goes much deeper.",
      },
      {
        question: "Can an AI agent use both?",
        answer:
          "Yes. Both have free MCP servers with no sign-in: `https://mcp.deepwiki.com/mcp` for DeepWiki and `https://gitdiagram.com/mcp` for GitDiagram, whose diagrams are also plain Markdown at `gitdiagram.com/{owner}/{repo}.md`.",
      },
    ],
    sources: [
      {
        label: "DeepWiki docs (Devin docs)",
        url: "https://docs.devin.ai/work-with-devin/deepwiki",
      },
      {
        label: "Cognition: DeepWiki announcement",
        url: "https://cognition.com/blog/deepwiki",
      },
      {
        label: "DeepWiki MCP server docs",
        url: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
      },
      { label: "Devin pricing", url: "https://devin.ai/pricing" },
      {
        label: "DeepWiki: expressjs/express",
        url: "https://deepwiki.com/expressjs/express",
      },
    ],
  },
  {
    slug: "sourcegraph",
    tool: "Sourcegraph",
    title: "GitDiagram vs Sourcegraph: an architecture map or code search",
    metaTitle: "GitDiagram vs Sourcegraph: Map or Code Search?",
    description:
      "Sourcegraph is code search and navigation across many repositories; GitDiagram draws an architecture diagram of one. When each is the right tool, with pricing and private code.",
    verdict:
      "Sourcegraph and GitDiagram do different jobs. Sourcegraph is code search: it finds exact things across many repositories (a regular expression, a symbol, every reference to a function) and lets you jump through the code. GitDiagram draws a picture of how one repository is put together. Choose Sourcegraph when you need exact, complete answers from the code, especially across a large company's repositories; choose GitDiagram when you want to see a repository's main parts and how they connect, for free and without setup. Sourcegraph does not draw an architecture overview on its own.",
    chooseOther: [
      "You need every match: all callers of a function, every use of an API.",
      "You search across hundreds or thousands of repositories at once.",
      "You want precise go-to-definition and find-references in the browser.",
      "Your company can buy an enterprise contract for its private code.",
    ],
    chooseGitDiagram: [
      "You are new to a repository and want its shape before reading code.",
      "You want a diagram to share or put in your docs.",
      "You want something free for private repositories.",
      "You don't know yet what to search for.",
    ],
    sections: [
      {
        id: "same-repository",
        heading: "The same repository in both",
        paragraphs: [
          "Open FastAPI on [Sourcegraph](https://sourcegraph.com/r/github.com/fastapi/fastapi) and you get its files with search and code navigation, free and without signing in. Search such as `repo:fastapi/fastapi Depends(` lists every match with its line.",
          "Open [FastAPI on GitDiagram](/fastapi/fastapi) and you get one diagram of 20 components in 4 groups with 22 labeled connections, each component linked to its file or folder on GitHub.",
          "The two fit together: the diagram shows where things live, and code search finds every place a thing is used.",
        ],
      },
      {
        id: "sourcegraph",
        heading: "What Sourcegraph does",
        paragraphs: [
          "Sourcegraph Code Search supports regular expressions, boolean and keyword queries, symbol, commit and diff search, and code navigation, on any code host and across many repositories. Public open source code can be searched free at [sourcegraph.com/search](https://sourcegraph.com/search).",
          "Private code needs Sourcegraph Enterprise, which its pricing page lists as starting at $16K on an annual contract, self-hosted or in a single-tenant cloud. Its AI agent, Deep Search, answers questions in plain language with sources and can draw diagrams when asked, on enterprise plans. Sourcegraph has an MCP server on enterprise instances. Cody Free and Pro ended in July 2025, and Sourcegraph's main repository stopped being public in 2024.",
        ],
      },
      {
        id: "gitdiagram",
        heading: "What GitDiagram does",
        paragraphs: [
          "Replace `hub` with `diagram` in a GitHub URL to get an interactive diagram of the repository's main parts. You can pan and zoom, read a written overview, export a PNG or copy the Mermaid code.",
          GD_LIMITS,
        ],
      },
    ],
    facts: [
      {
        label: "What you get",
        gitdiagram: GD.output,
        other:
          "Search results and code navigation across repositories; Deep Search answers on enterprise plans.",
      },
      {
        label: "Setup",
        gitdiagram: GD.setup,
        other:
          "None for public code on sourcegraph.com; private code needs an enterprise instance.",
      },
      {
        label: "Reads the code",
        gitdiagram: GD.readsCode,
        other:
          "Yes: it indexes every file, which is why its answers are exact.",
      },
      {
        label: "Private code",
        gitdiagram: GD.private,
        other: "Yes, with Sourcegraph Enterprise.",
      },
      {
        label: "Price",
        gitdiagram: GD.price,
        other:
          "Public search is free. Enterprise is listed as starting at $16K on an annual contract.",
      },
      {
        label: "For AI agents",
        gitdiagram: GD.agents,
        other:
          "An MCP server on enterprise instances, signed in by OAuth or token.",
      },
    ],
    questions: [
      {
        question: "Is Sourcegraph free?",
        answer:
          "Searching public open source code on sourcegraph.com is free. Searching your company's private code needs Sourcegraph Enterprise, a paid annual contract.",
      },
      {
        question: "Can Sourcegraph make an architecture diagram?",
        answer:
          "Not by itself. Its Deep Search agent can draw a diagram when you ask it to, on enterprise plans. GitDiagram makes an architecture diagram of any GitHub repository automatically.",
      },
      {
        question: "Is Cody still available?",
        answer:
          "Cody Free and Cody Pro stopped taking new users in June 2025 and ended in July 2025, according to Sourcegraph. Enterprise customers kept access.",
      },
    ],
    sources: [
      {
        label: "Sourcegraph Code Search docs",
        url: "https://sourcegraph.com/docs/code-search",
      },
      {
        label: "Sourcegraph Deep Search docs",
        url: "https://sourcegraph.com/docs/deep-search",
      },
      { label: "Sourcegraph pricing", url: "https://sourcegraph.com/pricing" },
      {
        label: "Sourcegraph MCP server docs",
        url: "https://sourcegraph.com/docs/api/mcp",
      },
      {
        label: "Sourcegraph: changes to Cody Free and Pro",
        url: "https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans",
      },
      {
        label: "DevClass: Sourcegraph makes its core repository private",
        url: "https://devclass.com/2024/08/21/sourcegraph-makes-core-repository-private-co-founder-complains-open-source-means-extra-work-and-risk/",
      },
    ],
  },
  {
    slug: "mermaid",
    tool: "Mermaid",
    title: "GitDiagram vs Mermaid: who writes the diagram",
    metaTitle: "GitDiagram vs Mermaid: Write or Generate a Diagram",
    description:
      "Mermaid is a language for writing diagrams by hand; GitDiagram reads a repository and writes the Mermaid for you. How they differ, how they work together, with real output.",
    verdict:
      "Mermaid is a diagram language, not a code analysis tool: you write text and it draws the picture, and GitHub shows Mermaid inside Markdown files. GitDiagram reads a GitHub repository, decides which parts matter and how they connect, and writes that diagram in Mermaid for you. Choose Mermaid to draw and maintain exactly the diagram you want in your own docs, of any kind (sequence, class, state, Gantt and many more). Choose GitDiagram when you want an architecture diagram of a repository without writing it, then copy its Mermaid code as a first draft to edit.",
    chooseOther: [
      "You know exactly what the diagram should show.",
      "You need a sequence, class, state, entity-relationship or other non-flowchart diagram.",
      "The diagram lives in your docs and changes with your code reviews.",
      "You want to diagram something that is not a repository.",
    ],
    chooseGitDiagram: [
      "You want an architecture diagram of a repository you haven't read yet.",
      "You don't want to write the diagram yourself.",
      "You want each box linked to its code on GitHub.",
      "You want a first draft in Mermaid to edit.",
    ],
    sections: [
      {
        id: "same-repository",
        heading: "The same repository: GitDiagram's Mermaid output",
        paragraphs: [
          "GitDiagram's diagrams are Mermaid flowcharts. Here is the start of the code behind [the Express diagram](/expressjs/express), exactly as Export, Copy Mermaid gives it. The full diagram has 16 components and 21 connections in 80 lines; paste it into a code block marked `mermaid` in any GitHub Markdown file and GitHub draws it.",
        ],
        code: {
          caption: "Mermaid exported from gitdiagram.com/expressjs/express",
          text: `flowchart TD

subgraph group_entry["Application Entry"]
  node_app["Express Application<br/>[application.js]"]
  node_factory["Application Factory<br/>[express.js]"]
end

subgraph group_routing["Routing Pipeline"]
  node_router["Router Integration<br/>[express.js]"]
  node_route_handlers["Application Handlers"]
end

node_client(("HTTP Client"))
node_node_http["Node HTTP Server"]

node_client -->|"sends request"| node_node_http
node_node_http -->|"dispatches request"| node_app
node_factory -->|"creates application"| node_app
node_app -->|"dispatches request"| node_router`,
        },
      },
      {
        id: "mermaid",
        heading: "What Mermaid does",
        paragraphs: [
          "Mermaid is open source (MIT) and turns text into diagrams: flowcharts, sequence, class, state, entity-relationship, Gantt, pie, C4, mindmap, timeline, Sankey, XY chart, block, kanban and more, with several newer types in beta. Write it in the [Mermaid Live Editor](https://mermaid.live), with the JavaScript library on your own site, or in Markdown on GitHub, which renders Mermaid blocks in issues, pull requests, discussions, wikis and files.",
          "Mermaid does not read code: every diagram is written by hand (or by a tool such as GitDiagram). By default it caps a diagram at 50,000 characters of text and 500 connections. GitHub runs a fixed Mermaid version of its own, so the newest syntax may not render there yet. The company behind Mermaid also sells an editor with AI features (mermaid.ai, formerly Mermaid Chart): a free Basic plan, then $10 or $20 per user per month, billed yearly.",
        ],
      },
      {
        id: "gitdiagram",
        heading: "What GitDiagram does",
        paragraphs: [
          "An AI model reads the repository's file tree, README and up to 12 source files and returns a graph of the main components; GitDiagram checks every linked path against the repository and compiles the graph to Mermaid. On the page, each component opens its file or folder on GitHub.",
          GD_LIMITS,
        ],
      },
    ],
    facts: [
      {
        label: "What you get",
        gitdiagram: GD.output,
        other: "Whatever diagram you write, in more than 20 diagram types.",
      },
      {
        label: "Reads the code",
        gitdiagram: GD.readsCode,
        other: "No. You write the diagram.",
      },
      {
        label: "Setup",
        gitdiagram: GD.setup,
        other:
          "None on GitHub or mermaid.live; `npm install mermaid` for your own site.",
      },
      {
        label: "Price",
        gitdiagram: GD.price,
        other:
          "The library is free (MIT). The hosted editor at mermaid.ai has a free plan and paid plans from $10 per user per month.",
      },
      {
        label: "Open source",
        gitdiagram: GD.openSource,
        other: "Yes, MIT, with about 91,000 GitHub stars.",
      },
    ],
    questions: [
      {
        question: "Can Mermaid generate a diagram from my code?",
        answer:
          "No. Mermaid draws diagrams you write in its text syntax. Tools such as GitDiagram (any GitHub repository) and dependency-cruiser (JavaScript and TypeScript imports) can write Mermaid for you.",
      },
      {
        question: "Can I edit a GitDiagram diagram?",
        answer:
          "Yes. Use Export, Copy Mermaid, then edit the code in the Mermaid Live Editor or in a Markdown file. Click links point to files on GitHub.",
      },
      {
        question: "Does GitHub render Mermaid?",
        answer:
          "Yes, in Markdown files, issues, pull requests, discussions and wikis, inside a code block marked `mermaid`.",
      },
    ],
    sources: [
      { label: "Mermaid docs: intro", url: "https://mermaid.js.org/intro/" },
      {
        label: "Mermaid docs: usage",
        url: "https://mermaid.js.org/config/usage.html",
      },
      {
        label: "Mermaid config schema (limits)",
        url: "https://mermaid.js.org/config/schema-docs/config.html",
      },
      {
        label: "GitHub docs: creating diagrams",
        url: "https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams",
      },
      { label: "Mermaid pricing", url: "https://mermaid.ai/pricing" },
      {
        label: "mermaid-js/mermaid on GitHub",
        url: "https://github.com/mermaid-js/mermaid",
      },
    ],
  },
  {
    slug: "dependency-cruiser",
    tool: "dependency-cruiser",
    title:
      "GitDiagram vs dependency-cruiser: architecture overview or exact dependency rules",
    metaTitle: "GitDiagram vs dependency-cruiser",
    description:
      "dependency-cruiser maps and validates every JavaScript and TypeScript import, with rules for CI; GitDiagram gives an AI overview of any repository. Real output from both on Express.",
    verdict:
      'dependency-cruiser and GitDiagram answer different questions. dependency-cruiser reads every import in a JavaScript or TypeScript project and gives an exact, complete dependency graph, and it checks rules you write, such as no circular dependencies or "the UI must not import the database", failing the build when one breaks. GitDiagram gives an AI-made overview of any GitHub repository, in any language, with nothing to install. Choose dependency-cruiser for exact answers and enforcing architecture in CI; choose GitDiagram for a quick picture of how a repository is organized. Many teams would use both.',
    chooseOther: [
      "You need every module and import, with nothing left out.",
      "You want to fail CI on circular dependencies, orphans or forbidden imports.",
      "Your code is JavaScript or TypeScript (including Vue and Svelte).",
      "The code must not leave your machine.",
    ],
    chooseGitDiagram: [
      "You want the main parts and how they connect, not every file.",
      "The repository is in Python, Go, Rust, Java or another language.",
      "You don't want to clone or install anything.",
      'You want connections described in words ("dispatches request"), not only arrows between files.',
    ],
    sections: [
      {
        id: "same-repository",
        heading: "The same repository in both",
        paragraphs: [
          `We ran dependency-cruiser 18.7.2 on Express's \`lib\` folder (commit ${EXPRESS_COMMIT}, 2026-11-02) on 2026-11-09, with no configuration. It found 41 modules and 51 dependencies: Express's 6 files, 7 Node.js built-ins and 28 npm packages (unresolved, because we did not install them). Limited to \`lib\`, its Mermaid output is the exact file graph:`,
        ],
        code: {
          caption:
            'npx depcruise lib --no-config --include-only "^lib" --output-type mermaid',
          text: `flowchart LR

subgraph 0["lib"]
1["application.js"]
2["utils.js"]
3["view.js"]
4["express.js"]
5["request.js"]
6["response.js"]
end
1-->2
1-->3
4-->1
4-->5
4-->6
6-->2`,
        },
      },
      {
        id: "same-repository-gitdiagram",
        heading: "What GitDiagram shows for it",
        paragraphs: [
          "[GitDiagram's Express diagram](/expressjs/express) has 16 components in 5 groups with 21 labeled connections. Besides Express's own files it shows what they work with: the HTTP client, Node's HTTP server, the separate router package, template engines, the filesystem and the final error handler, with connections such as \"dispatches request\" and \"augments response\". It is an interpretation, not a parse: dependency-cruiser's six arrows are exact, GitDiagram's picture is the one a person would draw on a whiteboard.",
        ],
      },
      {
        id: "dependency-cruiser",
        heading: "What dependency-cruiser does",
        paragraphs: [
          "dependency-cruiser validates and visualizes dependencies for JavaScript, TypeScript, LiveScript and CoffeeScript (ES modules, CommonJS and AMD), including `.jsx`, `.tsx`, `.vue` and `.svelte` files, using the compilers already in your project. Install it with `npm install --save-dev dependency-cruiser` and run `npx depcruise --init` to get a configuration with sensible rules (no circular dependencies, no orphans, nothing missing from package.json).",
          "Its rules are `forbidden` patterns with a severity; with the `err` reporter the exit code is the number of errors, so CI fails when a rule breaks. It reports in many formats, among them dot (Graphviz), Mermaid, D2, HTML, JSON, CSV and Markdown; images need Graphviz installed. It is MIT licensed and actively released (18.7.2 on 2026-11-02). It cannot follow imports built from variables (`require(someVariable)`), and its own FAQ warns that graphs of large projects get huge.",
        ],
      },
      {
        id: "gitdiagram",
        heading: "What GitDiagram does",
        paragraphs: [
          "Replace `hub` with `diagram` in a GitHub URL. An AI model reads the file tree, README and up to 12 source files and draws the main components; you can export the result as Mermaid.",
          GD_LIMITS,
        ],
      },
    ],
    facts: [
      {
        label: "What you get",
        gitdiagram: GD.output,
        other:
          "An exact module graph and rule violations, in formats such as dot, Mermaid, D2, HTML and JSON.",
      },
      {
        label: "Languages",
        gitdiagram: "Any language in a GitHub repository.",
        other:
          "JavaScript, TypeScript, LiveScript and CoffeeScript, with Vue and Svelte files.",
      },
      {
        label: "Setup",
        gitdiagram: GD.setup,
        other:
          "Install from npm in your project; Graphviz for images. Runs on your machine or in CI.",
      },
      {
        label: "Private code",
        gitdiagram: GD.private,
        other: "Yes: it runs locally, so the code stays where it is.",
      },
      {
        label: "Price",
        gitdiagram: GD.price,
        other: "Free, MIT.",
      },
    ],
    questions: [
      {
        question:
          "How do I find circular dependencies in a JavaScript project?",
        answer:
          "Run `npx depcruise --init`, which adds a no-circular rule, then `npx depcruise src`; it lists every cycle and exits with an error code. Madge's `madge --circular src` is a quicker one-off check.",
      },
      {
        question: "Does GitDiagram enforce architecture rules?",
        answer:
          "No. GitDiagram draws an overview; it does not check imports or run in CI. Use dependency-cruiser for that.",
      },
      {
        question: "Can dependency-cruiser output Mermaid?",
        answer:
          "Yes, with `--output-type mermaid`, as in the Express example on this page.",
      },
    ],
    sources: [
      {
        label: "dependency-cruiser on GitHub",
        url: "https://github.com/sverweij/dependency-cruiser",
      },
      {
        label: "dependency-cruiser CLI docs",
        url: "https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md",
      },
      {
        label: "dependency-cruiser rules reference",
        url: "https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md",
      },
      {
        label: "dependency-cruiser FAQ",
        url: "https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md",
      },
      {
        label: "dependency-cruiser on npm",
        url: "https://www.npmjs.com/package/dependency-cruiser",
      },
    ],
  },
  {
    slug: "madge",
    tool: "Madge",
    title: "GitDiagram vs Madge: architecture overview or module graph",
    metaTitle: "GitDiagram vs Madge: Overview or Module Graph",
    description:
      "Madge graphs JavaScript module dependencies and finds circular imports; GitDiagram draws an AI architecture overview of any repository. Real output from both on Express.",
    verdict:
      "Madge draws a graph of a JavaScript project's module dependencies and finds circular imports, from one command on your own machine. GitDiagram gives an AI-made overview of the main parts of any GitHub repository, in any language, with nothing to install. Choose Madge for a quick, exact look at which file imports which, or a circular-dependency check; choose GitDiagram to understand what a repository's parts do and how they connect. Note that Madge's last release, 8.0.0, came out in August 2024; for rules enforced in CI, dependency-cruiser is the actively maintained choice.",
    chooseOther: [
      "You want to see exactly which file imports which.",
      "You want a fast circular-dependency check (`madge --circular`).",
      "You want orphan or leaf modules listed.",
      "The code must stay on your machine.",
    ],
    chooseGitDiagram: [
      "You want the main components and what they do, not every file.",
      "The repository is not JavaScript.",
      "You don't want to clone or install anything.",
      "You want a diagram that stays readable for a large project.",
    ],
    sections: [
      {
        id: "same-repository",
        heading: "The same repository in both",
        paragraphs: [
          `We ran Madge 8.0.0 on Express's \`lib\` folder (commit ${EXPRESS_COMMIT}, 2026-11-02) on 2026-11-09. \`madge --circular lib\` processed 6 files and printed "No circular dependency found!"; the 28 warnings were the npm packages it skips. \`madge --json lib\` gave the file graph:`,
        ],
        code: {
          caption: "npx madge --json lib",
          text: `{
  "application.js": ["utils.js", "view.js"],
  "express.js": ["application.js", "request.js", "response.js"],
  "request.js": [],
  "response.js": ["utils.js"],
  "utils.js": [],
  "view.js": []
}`,
        },
      },
      {
        id: "same-repository-gitdiagram",
        heading: "What GitDiagram shows for it",
        paragraphs: [
          "[GitDiagram's Express diagram](/expressjs/express) has 16 components in 5 groups with 21 labeled connections, including the parts Express works with that Madge leaves out: Node's HTTP server, the router package, template engines, the filesystem and the final error handler. Madge's graph is exact; GitDiagram's is an AI interpretation of what matters.",
        ],
      },
      {
        id: "madge",
        heading: "What Madge does",
        paragraphs: [
          'Madge is "a developer tool for generating a visual graph of your module dependencies, finding circular dependencies, and giving you other useful info". It reads JavaScript as AMD, CommonJS and ES modules, plus Sass, Stylus and Less, and TypeScript with `--extensions ts` and `--ts-config`. Run `npx madge --image graph.svg src/` for a picture (Graphviz needed), or `--json`, `--dot`, `--circular`, `--orphans` and `--leaves` for text. `--circular` exits with code 1 when it finds a cycle, so it works as a simple CI check; there is no rule engine beyond that.',
          "It is MIT licensed with about 10,000 GitHub stars. By default it scans only `.js` files, skipped files are reported only with `--warning`, and its own FAQ says images of big graphs are hard to read.",
        ],
      },
      {
        id: "gitdiagram",
        heading: "What GitDiagram does",
        paragraphs: [
          "Replace `hub` with `diagram` in a GitHub URL. An AI model reads the file tree, README and up to 12 source files and draws the main components, each linked to its code.",
          GD_LIMITS,
        ],
      },
    ],
    facts: [
      {
        label: "What you get",
        gitdiagram: GD.output,
        other:
          "A file-by-file dependency graph (image, dot or JSON) and lists of circular, orphan and leaf modules.",
      },
      {
        label: "Languages",
        gitdiagram: "Any language in a GitHub repository.",
        other: "JavaScript and TypeScript, plus Sass, Stylus and Less.",
      },
      {
        label: "Setup",
        gitdiagram: GD.setup,
        other: "`npm install -g madge` or `npx madge`; Graphviz for images.",
      },
      {
        label: "Private code",
        gitdiagram: GD.private,
        other: "Yes: it runs locally.",
      },
      {
        label: "Price",
        gitdiagram: GD.price,
        other: "Free, MIT. Last release 8.0.0, August 2024.",
      },
    ],
    questions: [
      {
        question:
          "How do I check a JavaScript project for circular dependencies?",
        answer:
          "Run `npx madge --circular src/` (add `--extensions ts` for TypeScript). It lists each cycle and exits with code 1 if there is one.",
      },
      {
        question: "Is Madge still maintained?",
        answer:
          "Its latest release on npm is 8.0.0, from 2024-08-05, which is also the last commit on its main branch as of 2026-11-09. It still works for many projects; dependency-cruiser is the actively released alternative.",
      },
    ],
    sources: [
      { label: "Madge on GitHub", url: "https://github.com/pahen/madge" },
      {
        label: "Madge CLI source",
        url: "https://github.com/pahen/madge/blob/master/bin/cli.js",
      },
      { label: "Madge on npm", url: "https://www.npmjs.com/package/madge" },
    ],
  },
  {
    slug: "structurizr",
    tool: "Structurizr",
    title: "GitDiagram vs Structurizr: generated diagram or C4 model as code",
    metaTitle: "GitDiagram vs Structurizr: Generated or C4 Model",
    description:
      "Structurizr builds C4 architecture models you write as code; GitDiagram generates a diagram from a GitHub repository. When each fits, and what changed with Structurizr's cloud service.",
    verdict:
      'Structurizr is a "models as code" tool for the C4 model: you describe your software (people, systems, containers, components) once in the Structurizr DSL and get many consistent diagrams from it, from system context down to deployment. It does not read your code, apart from a Java component finder you configure. GitDiagram reads a GitHub repository and draws its architecture automatically. Choose Structurizr for a deliberate, reviewed architecture model of one or many systems that you maintain over time; choose GitDiagram for a picture of an existing repository right now, or as a starting point for that model. Structurizr\'s hosted cloud service has reached end of life, so it now runs on your own machine or server.',
    chooseOther: [
      "You follow the C4 model and want context, container, component and deployment views.",
      "You want several diagrams kept consistent from one model.",
      "The architecture spans many repositories or systems.",
      "You want the model reviewed in pull requests like code.",
    ],
    chooseGitDiagram: [
      "You want a diagram of a repository without writing a model.",
      "You are exploring code you didn't write.",
      "You want each box linked to its code on GitHub.",
      "You want something hosted and free.",
    ],
    sections: [
      {
        id: "same-repository",
        heading: "The same repository",
        paragraphs: [
          "Structurizr has no automatic output to compare: a person writes the model. GitDiagram's diagram is a useful place to start one. Its [Express diagram](/expressjs/express) names 16 components; turned into Structurizr DSL by hand, the core of it might begin like this (our sketch, not Structurizr output):",
        ],
        code: {
          caption: "workspace.dsl, written by hand",
          text: `workspace {
    model {
        client = person "HTTP client"
        service = softwareSystem "Web service" {
            webapp = container "Express app" "" "Node.js" {
                app = component "Express Application" "lib/application.js"
                request = component "Request API" "lib/request.js"
                response = component "Response API" "lib/response.js"
            }
        }
        client -> app "Sends requests"
        app -> request "Augments request"
        app -> response "Augments response"
    }
    views {
        component webapp {
            include *
            autolayout lr
        }
    }
}`,
        },
      },
      {
        id: "structurizr",
        heading: "What Structurizr does",
        paragraphs: [
          "Structurizr was built by Simon Brown, who created the C4 model. From one workspace it renders system landscape, system context, container, component and code views, plus dynamic and deployment views, and it exports to PlantUML, C4-PlantUML, Mermaid, WebSequenceDiagrams, PNG, SVG or a static site. Its Java component finder can build a component view from Java code, using rules you write.",
          "The hosted cloud service has reached end of life with no replacement. Structurizr now ships as one tool (a Docker image or a `.war` file) with `local` (formerly Lite) to view a workspace on your machine, `server` (formerly on-premises) for a team, a browser Playground and an MCP server. Everything is free except the prebuilt `server`, which is licensed per installation by number of users, from £300 a month for up to 20.",
        ],
      },
      {
        id: "gitdiagram",
        heading: "What GitDiagram does",
        paragraphs: [
          "Replace `hub` with `diagram` in a GitHub URL. An AI model reads the file tree, README and up to 12 source files and draws the main components in groups, each linked to its code; you can export the result as Mermaid.",
          GD_LIMITS,
        ],
      },
    ],
    facts: [
      {
        label: "What you get",
        gitdiagram: GD.output,
        other:
          "Every C4 view of a model you write, kept consistent, exported to many formats.",
      },
      {
        label: "Reads the code",
        gitdiagram: GD.readsCode,
        other: "No, except a Java component finder driven by your own rules.",
      },
      {
        label: "Setup",
        gitdiagram: GD.setup,
        other:
          "Write a DSL workspace; view it with the Docker image, the `.war` file or the Playground.",
      },
      {
        label: "Hosting and privacy",
        gitdiagram: GD.private,
        other: "Self-hosted only, since the cloud service ended.",
      },
      {
        label: "Price",
        gitdiagram: GD.price,
        other:
          "Free, except the prebuilt server: from £300 a month for up to 20 users.",
      },
    ],
    questions: [
      {
        question: "Is the Structurizr cloud service still available?",
        answer:
          "No. Structurizr's docs say the cloud service has reached end of life with no replacement. Use `structurizr local` or a self-hosted `structurizr server` instead.",
      },
      {
        question: "Can Structurizr generate a diagram from my code?",
        answer:
          "Only component views of Java code, with the component finder and rules you configure. Otherwise you write the model. GitDiagram generates a diagram from any GitHub repository.",
      },
    ],
    sources: [
      { label: "Structurizr docs", url: "https://docs.structurizr.com/" },
      {
        label: "Structurizr: end of life changes",
        url: "https://docs.structurizr.com/eol",
      },
      {
        label: "Structurizr server pricing",
        url: "https://docs.structurizr.com/server/pricing",
      },
      {
        label: "Structurizr Java component finder",
        url: "https://docs.structurizr.com/java/component",
      },
      { label: "Structurizr", url: "https://structurizr.com/" },
    ],
  },
];

export function comparePage(slug: string): ComparePage | undefined {
  return COMPARE_PAGES.find((page) => page.slug === slug);
}

// ---------------------------------------------------------------------------
// The roundup.

export interface RoundupTool {
  name: string;
  bestFor: string;
  text: string;
  /** Reads the code on its own (as opposed to diagrams you write). */
  readsCode: string;
  price: string;
  href: string;
  /** This site's comparison page, if there is one. */
  compare?: string;
}

export const ROUNDUP_TITLE =
  "Codebase visualization tools compared: the best one for each job";
export const ROUNDUP_META_TITLE = "Best Codebase Visualization Tools (2026)";
export const ROUNDUP_DESCRIPTION =
  "An honest roundup of codebase visualization tools: GitDiagram, DeepWiki, Sourcegraph, dependency-cruiser, Madge, pydeps, Mermaid, PlantUML, Structurizr and coding agents, with what each is best for.";

export const ROUNDUP_VERDICT =
  "There is no single best codebase visualization tool, because they answer different questions. For one architecture diagram of a whole GitHub repository with nothing to install, use GitDiagram (we make it). For a written wiki and a chat about a repository, DeepWiki. For exact JavaScript or TypeScript dependency graphs and rules checked in CI, dependency-cruiser, or Madge for a quick circular-import check; for Python imports, pydeps. For diagrams you write and maintain in your docs, Mermaid or PlantUML, and Structurizr for a C4 architecture model. For searching code across many repositories, Sourcegraph. For a focused diagram of one flow in code on your own machine, ask a coding agent such as Claude Code or Codex.";

export const ROUNDUP_DISCLOSURE =
  "GitDiagram wrote this page, so weigh what it says about GitDiagram accordingly. We included the tools developers and AI assistants name most when asked how to visualize a codebase, checked each one against its own site and docs on 2026-11-09, and link the sources. Nothing here is paid placement.";

export const ROUNDUP_TOOLS: RoundupTool[] = [
  {
    name: "GitDiagram",
    bestFor: "One interactive architecture diagram of any GitHub repository",
    text: "Replace `hub` with `diagram` in a GitHub URL and get the repository's main components (up to 34) in groups, with labeled connections, each linked to its code, plus a written overview. Exports Mermaid and PNG; private repositories work with a GitHub token kept in your browser. It is an AI-made map of the main parts, not a complete dependency graph.",
    readsCode: "Yes (AI, from the file tree, README and up to 12 files)",
    price: "Free, open source (MIT)",
    href: "/visualize-codebase",
  },
  {
    name: "DeepWiki",
    bestFor: "A written wiki and a chat about a public repository",
    text: "Replace `github.com` with `deepwiki.com` to read dozens of generated pages with diagrams, and ask questions in a chat. Private repositories need a Devin account.",
    readsCode: "Yes (AI)",
    price: "Free for public repositories; Devin plans from $20 a month",
    href: "https://deepwiki.com",
    compare: "deepwiki",
  },
  {
    name: "Sourcegraph",
    bestFor: "Exact code search across many repositories",
    text: "Regular expression, symbol and commit search with code navigation, across any number of repositories. Public code search is free; private code needs an enterprise contract. It does not draw architecture diagrams on its own.",
    readsCode: "Yes (indexes every file)",
    price: "Public search free; Enterprise listed from $16K (annual contract)",
    href: "https://sourcegraph.com",
    compare: "sourcegraph",
  },
  {
    name: "dependency-cruiser",
    bestFor:
      "Exact JavaScript and TypeScript dependency graphs, with rules in CI",
    text: "Maps every import and fails the build on rules you set: no cycles, no orphans, forbidden paths. Outputs dot, Mermaid, D2, HTML, JSON and more. Actively released.",
    readsCode: "Yes (static analysis, every import)",
    price: "Free, MIT",
    href: "https://github.com/sverweij/dependency-cruiser",
    compare: "dependency-cruiser",
  },
  {
    name: "Madge",
    bestFor: "A quick JavaScript module graph and circular-import check",
    text: "One command draws the module graph or lists circular dependencies. Simple and widely used; its latest release is from August 2024.",
    readsCode: "Yes (static analysis, every import)",
    price: "Free, MIT",
    href: "https://github.com/pahen/madge",
    compare: "madge",
  },
  {
    name: "pydeps",
    bestFor: "Python module dependency graphs",
    text: "Draws a Python package's imports with Graphviz, highlights cycles, and limits how far out it draws (`--max-bacon`). It reads the imports Python actually compiles, so only modules that are imported show up.",
    readsCode: "Yes (from compiled imports)",
    price: "Free, BSD-2-Clause",
    href: "https://github.com/thebjorn/pydeps",
  },
  {
    name: "Mermaid",
    bestFor: "Diagrams you write and keep in Markdown",
    text: "A text language for flowcharts, sequence, class, state and many other diagrams. GitHub renders it in Markdown. It does not read code; tools such as GitDiagram and dependency-cruiser can write it for you.",
    readsCode: "No (you write it)",
    price: "Free, MIT; hosted editor from $10 per user per month",
    href: "https://mermaid.js.org",
    compare: "mermaid",
  },
  {
    name: "PlantUML",
    bestFor: "UML diagrams written as text",
    text: "Turns text descriptions into UML diagrams (sequence, class, component and more). Like Mermaid, you write the diagram.",
    readsCode: "No (you write it)",
    price: "Free, open source",
    href: "https://github.com/plantuml/plantuml",
  },
  {
    name: "Structurizr",
    bestFor: "A C4 architecture model kept as code",
    text: "Write one model in the Structurizr DSL and get consistent context, container, component and deployment views. Its cloud service has ended; it runs locally or on your own server.",
    readsCode: "No, except Java components with your own rules",
    price: "Free, except the prebuilt server (from £300 a month)",
    href: "https://structurizr.com",
    compare: "structurizr",
  },
  {
    name: "Claude Code, Codex or another coding agent",
    bestFor: "A focused diagram of one flow, in code on your own machine",
    text: "Ask the agent in your checkout to draw a Mermaid diagram of one feature or request path. It can read every file, including private and uncommitted code, but you get a new diagram each time rather than a page to share.",
    readsCode: "Yes (AI, any file you let it read)",
    price: "Your agent's subscription or API cost",
    href: "/visualize-codebase#alternatives",
  },
];

export const ROUNDUP_NOTES: string[] = [
  "CodeSee, once a popular tool for code maps, is no longer available: it was acquired by GitKraken in 2024, and its codesee.io site no longer resolves (checked 2026-11-09).",
  "Some IDEs, including JetBrains IDEs, can also draw dependency or class diagrams of the project you have open, which is handy if you already use one.",
];

export const ROUNDUP_QUESTIONS: GuideQuestion[] = [
  {
    question: "What is the best free tool to visualize a GitHub repository?",
    answer:
      "For an architecture diagram with nothing to install, GitDiagram: replace `hub` with `diagram` in the repository's URL. For a written explanation, DeepWiki. For an exact import graph of a JavaScript or TypeScript project, dependency-cruiser or Madge. All of these are free for public repositories.",
  },
  {
    question: "Can I generate an architecture diagram from code automatically?",
    answer:
      "Yes. GitDiagram and DeepWiki generate diagrams from a GitHub repository with AI; dependency-cruiser, Madge and pydeps generate exact import graphs from the code. Mermaid, PlantUML and Structurizr draw diagrams you write.",
  },
  {
    question: "Is CodeSee still available?",
    answer:
      "No. GitKraken acquired CodeSee in 2024, and the codesee.io site no longer resolves. GitDiagram (architecture diagrams) and dependency-cruiser (dependency maps and rules) cover much of what it did.",
  },
  {
    question: "How do I find circular dependencies?",
    answer:
      "In JavaScript or TypeScript, `npx madge --circular src/` for a quick check, or dependency-cruiser's no-circular rule in CI. In Python, `pydeps --show-cycles`.",
  },
];

export const ROUNDUP_SOURCES: CompareSource[] = [
  {
    label: "pydeps on GitHub",
    url: "https://github.com/thebjorn/pydeps",
  },
  {
    label: "PlantUML on GitHub",
    url: "https://github.com/plantuml/plantuml",
  },
  {
    label: "GitKraken acquires CodeSee",
    url: "https://www.gitkraken.com/blog/gitkraken-launches-devex-platform-acquires-codesee",
  },
];
