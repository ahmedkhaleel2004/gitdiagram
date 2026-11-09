import type { CompareSource } from "~/features/compare/content";
import type { GuideQuestion } from "~/features/guide/content";
import type { SITUATION_SLUGS } from "./slugs";

// Situation guides (/guides/{slug}): pages built around a real moment when
// someone needs to understand a repository ("I just joined a team with a
// huge monorepo"), not around a keyword. Each answers its situation in the
// first paragraph, gives an honest workflow (other tools where they fit
// better), and shows a real stored diagram on gitdiagram.com. The situations
// come from the weekly AI prompt panel's misses and Search Console queries
// (report: reference/seo-2026-11-09/situation-pages.md on ahmed-vps).
//
// Text uses the guide's two inline marks: [label](href) links and `code`.
// Rendered as HTML, as Markdown (/guides/{slug}.md and /llms-full.txt) and
// as TechArticle + HowTo + FAQPage JSON-LD.

/** When every fact on these pages was last checked. Change only after rechecking. */
export const SITUATIONS_CHECKED = "2026-11-09";

interface SituationStep {
  name: string;
  text: string;
}

interface SituationSection {
  id: string;
  heading: string;
  paragraphs: string[];
  /** A verbatim block (code, a command and its output). */
  code?: { caption: string; text: string };
}

interface SituationExample {
  /** A repository with a stored diagram on this site, as owner/repo (lowercase). */
  repo: string;
  heading: string;
  paragraphs: string[];
  code?: { caption: string; text: string };
}

export interface SituationPage {
  slug: (typeof SITUATION_SLUGS)[number];
  /** The page's heading (h1). */
  title: string;
  /** The <title>: at most 60 characters, to fit a search result. */
  metaTitle: string;
  /** A short name for lists of guides. */
  label: string;
  description: string;
  /** The answer first: one paragraph. */
  answer: string;
  stepsHeading: string;
  /** The workflow, in order (also the HowTo's steps). */
  steps: SituationStep[];
  example: SituationExample;
  sections: SituationSection[];
  questions: GuideQuestion[];
  sources: CompareSource[];
}

export const GUIDES_HUB_PATH = "/visualize-codebase";

export function situationPath(slug: string): string {
  return `/guides/${slug}`;
}

/** The README picture of a stored diagram (see [username]/[repo]/diagram.png). */
export function diagramPicturePath(repo: string): string {
  return `/${repo}/diagram.png`;
}

const LIMITS =
  "GitDiagram's diagram is made by an AI model from the file tree, the README and up to 12 source files. It is a map of the important parts, at most 34 of them, not a complete dependency graph: it can simplify or leave things out, every linked path is checked against the real repository, and it shows the repository as it was when the diagram was made (Regenerate makes a fresh one).";

const SOURCES = {
  navigatingCode: {
    label: "GitHub Docs: Navigating code on GitHub",
    url: "https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github",
  },
  copilotExplore: {
    label: "GitHub Docs: Exploring a codebase with Copilot",
    url: "https://docs.github.com/en/copilot/tutorials/explore-a-codebase",
  },
  codeOwners: {
    label: "GitHub Docs: About code owners",
    url: "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners",
  },
  contributing: {
    label: "GitHub Docs: Setting guidelines for repository contributors",
    url: "https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors",
  },
  mermaidOnGitHub: {
    label: "GitHub Docs: Creating diagrams (Mermaid in Markdown)",
    url: "https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams",
  },
  mermaid: { label: "Mermaid documentation", url: "https://mermaid.js.org" },
  repoVisualizer: {
    label: "githubocto/repo-visualizer (archived)",
    url: "https://github.com/githubocto/repo-visualizer",
  },
  c4: { label: "The C4 model", url: "https://c4model.com" },
  pat: {
    label: "GitHub Docs: Managing your personal access tokens",
    url: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
  },
  appAuthorizations: {
    label: "GitHub Docs: Reviewing and revoking authorization of GitHub Apps",
    url: "https://docs.github.com/en/apps/using-github-apps/reviewing-and-revoking-authorization-of-github-apps",
  },
  gitdiagramSource: {
    label: "GitDiagram source code (MIT)",
    url: "https://github.com/ahmedkhaleel2004/gitdiagram",
  },
  dependencyCruiser: {
    label: "dependency-cruiser",
    url: "https://github.com/sverweij/dependency-cruiser",
  },
  pydeps: { label: "pydeps", url: "https://github.com/thebjorn/pydeps" },
  nxGraph: {
    label: "Nx: Explore your workspace (nx graph)",
    url: "https://nx.dev/docs/features/explore-graph",
  },
  turboRun: {
    label: "Turborepo: turbo run reference (--graph)",
    url: "https://turborepo.dev/docs/reference/run",
  },
  bazelQuery: {
    label: "Bazel: Query quickstart",
    url: "https://bazel.build/query/guide",
  },
  pnpmWorkspaces: {
    label: "pnpm: Workspaces",
    url: "https://pnpm.io/workspaces",
  },
  gitLog: { label: "git log", url: "https://git-scm.com/docs/git-log" },
  gitBlame: { label: "git blame", url: "https://git-scm.com/docs/git-blame" },
  reviewingPrs: {
    label: "GitHub Docs: Reviewing proposed changes in a pull request",
    url: "https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request",
  },
  ghPrCheckout: {
    label: "GitHub CLI: gh pr checkout",
    url: "https://cli.github.com/manual/gh_pr_checkout",
  },
  searchPrs: {
    label: "GitHub Docs: Searching issues and pull requests",
    url: "https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests",
  },
  gource: { label: "Gource", url: "https://gource.io" },
  dependencyGraph: {
    label: "GitHub Docs: About the dependency graph",
    url: "https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-the-dependency-graph",
  },
  claudeMemory: {
    label: "Claude Code docs: Memory (CLAUDE.md and /init)",
    url: "https://code.claude.com/docs/en/memory",
  },
  claudeMcp: {
    label: "Claude Code docs: MCP",
    url: "https://code.claude.com/docs/en/mcp",
  },
  agentsMd: { label: "AGENTS.md", url: "https://agents.md" },
  cursorRules: {
    label: "Cursor docs: Rules",
    url: "https://cursor.com/docs/context/rules",
  },
  mcp: {
    label: "Model Context Protocol",
    url: "https://modelcontextprotocol.io",
  },
} satisfies Record<string, CompareSource>;

const FASTAPI_PR = "https://github.com/fastapi/fastapi/pull/16594";

export const SITUATION_PAGES: SituationPage[] = [
  {
    slug: "understand-a-new-codebase",
    label: "Understand a new codebase fast",
    title: "How to understand a new codebase fast",
    metaTitle: "How to Understand a New Codebase Fast",
    description:
      "A first-week workflow for an unfamiliar codebase, at a new job or before your first open source contribution: get the map, follow one path, run it, then ask with context.",
    answer:
      "To understand a new codebase fast, get a map of its main parts before you open any file, then follow one real request or command through the code, run it, and read only what your first task touches. For a GitHub repository the map takes seconds: replace `hub` with `diagram` in its URL (`github.com/posthog/posthog` becomes [gitdiagram.com/posthog/posthog](/posthog/posthog)) for an architecture diagram with every part linked to its code. Your editor, a coding agent and the people on the team then fill in what the map leaves out.",
    stepsHeading: "A first-week workflow",
    steps: [
      {
        name: "Get the map",
        text: "Open the repository's diagram and read the short overview above it. Note the four or five groups, which parts sit on the main path, and the words the project uses for its own parts: they reappear in folder names. Treat the map as a list of places to look, not as the truth about every file.",
      },
      {
        name: "Read the README and the contributing guide",
        text: "They say what the project is for, how to run and test it, and how the team works. Many repositories keep the contributing guide in `CONTRIBUTING.md`; newer ones also have an `AGENTS.md` or `CLAUDE.md` written for coding agents, which is often the most up-to-date description of the layout.",
      },
      {
        name: "Follow one path end to end",
        text: "Pick something a user does (an API request, a CLI command, a button) and trace it from its entry point through the parts on the map. Go-to-definition and find-references do most of the work, in your editor or in the browser with GitHub's code navigation.",
      },
      {
        name: "Run it and change something small",
        text: "Run the tests, start the app, add a log line on the path you traced, or break something on purpose and see which test fails. Code you have run is much easier to remember than code you have read.",
      },
      {
        name: "Ask with context",
        text: 'Ask a coding agent in your checkout narrow questions ("where is a session started?"), and ask the team which parts of the map are wrong, old or about to change. A `CODEOWNERS` file, when there is one, says who owns each folder.',
      },
      {
        name: "Write down what you learned",
        text: "Correct the map as you go: export its Mermaid code, fix the boxes that were wrong and keep it with your notes. It becomes the onboarding document the next person needs.",
      },
    ],
    example: {
      repo: "posthog/posthog",
      heading: "Example: PostHog's codebase on day one",
      paragraphs: [
        "[PostHog's diagram](/posthog/posthog) (made 2026-10-14) has 20 parts in 5 groups: Collection, Data and queries, Product capabilities, User and agent access, and Platform services, with 16 labeled connections. Two things a newcomer learns from it in a minute: event ingestion is TypeScript under `nodejs/src/ingestion/` (analytics and session replay both build on one shared ingestion framework), while queries run in Python, with `posthog/hogql_queries/query_runner.py` handing results to a query cache that stores large results in object storage.",
        "The overview is also honest about its gaps: its connections come only from the README and the sampled files, so it does not claim an end-to-end pipeline it has not seen. That tells you where to start reading: the query runner, the ingestion framework, and whatever connects them.",
      ],
    },
    sections: [
      {
        id: "other-tools",
        heading: "When another tool fits better",
        paragraphs: [
          "For written explanations of each part and a chat about the code, [DeepWiki](/compare/deepwiki) writes a wiki of public repositories. For exact answers such as every caller of a function across many repositories, use [Sourcegraph](/compare/sourcegraph) or your editor. For a focused question about code you have checked out, including private or uncommitted code, ask a coding agent such as Copilot, Claude Code or Cursor; GitHub's own tutorial shows how with Copilot.",
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question:
          "It's my first week and the codebase is huge. How do I get a mental model fast?",
        answer:
          "Get a map of the main parts first (for a GitHub repository, replace `hub` with `diagram` in its URL), trace one real request through it, run it locally, and ask the team which parts of the map are wrong. Read deeply only what your first task touches.",
      },
      {
        question:
          "How do I get to know an open source project before my first contribution?",
        answer:
          "Read its contributing guide, look at the architecture diagram to find the part your issue is in, then read recently merged pull requests in that part: they show the review style and where the tests go.",
      },
    ],
    sources: [
      SOURCES.navigatingCode,
      SOURCES.copilotExplore,
      SOURCES.contributing,
      SOURCES.codeOwners,
    ],
  },
  {
    slug: "understand-a-monorepo",
    label: "Understand a large monorepo",
    title: "How to understand a large monorepo",
    metaTitle: "How to Understand a Large Monorepo",
    description:
      "Find the workspace list, draw the package graph with the monorepo's own tool, get a runtime picture of how the apps talk, then go deep in one package. With real examples.",
    answer:
      "To understand a large monorepo, start from its list of packages, not its files: find which apps run, which shared packages everything depends on, and who owns what, then go deep only in the packages your work touches. The monorepo's build tool draws the exact package graph (`nx graph` in Nx, `turbo run build --graph` in Turborepo, `bazel query` in Bazel). For a picture of what the main parts do and how they talk at runtime, an architecture diagram of the whole repository helps: [gitdiagram.com/supabase/supabase](/supabase/supabase) maps Supabase's monorepo in 18 parts.",
    stepsHeading: "How to approach it",
    steps: [
      {
        name: "Find the workspace definition",
        text: "Look for `pnpm-workspace.yaml`, `workspaces` in the root `package.json`, `nx.json`, `turbo.json`, `go.work`, a `[workspace]` table in `Cargo.toml`, or Bazel `BUILD` files. It lists every package. Most monorepos split them into things that run (`apps/`, `services/`) and shared code (`packages/`, `libs/`).",
      },
      {
        name: "Draw the package graph with the repository's own tool",
        text: "In Nx, `nx graph` opens an interactive graph in the browser and `nx graph --focus <project>` narrows it to one project. In Turborepo, `turbo run build --graph=graph.svg` writes the task graph as SVG, HTML, Mermaid or DOT. In Bazel, `bazel query 'deps(//path:target)'` lists what a target depends on. These graphs are exact because they come from the build configuration.",
      },
      {
        name: "Get the runtime picture",
        text: "A package graph shows who imports whom, not which app calls which service over the network or which job reads which queue. Look for architecture docs in the repository, and open its diagram on GitDiagram for a first picture of the main parts and their connections.",
      },
      {
        name: "Find the owners",
        text: "A `CODEOWNERS` file maps folders to the teams that review them: it tells you whom to ask about each part, and which parts are shared by everyone.",
      },
      {
        name: "Narrow to your slice",
        text: "Pick the app you work on and follow only its dependencies (`nx graph --focus`, or a Turborepo filter such as `--filter=<package>...`). Leave the rest of the repository for later.",
      },
    ],
    example: {
      repo: "supabase/supabase",
      heading: "Example: the Supabase monorepo",
      paragraphs: [
        "Supabase's repository is a pnpm and Turborepo workspace with 8 folders under `apps/` and 16 under `packages/` (checked 2026-11-09). [Its diagram](/supabase/supabase) has 18 parts in 4 groups (Dashboard, Database and APIs, Platform Services, Developer Resources) and 18 connections. The main path: a developer uses Studio (`apps/studio`), whose data layer (`apps/studio/data`) queries Postgres; Postgres is served as REST by PostgREST and as GraphQL by pg_graphql and streams changes to Realtime; an Envoy proxy routes requests to PostgREST, GoTrue auth, the Storage API and Functions.",
        "It also shows the limit of one diagram for a monorepo: Postgres, PostgREST and GoTrue appear without links because they are services the README describes, not folders in this repository, and most of `packages/` is not on the map. For those, the package graph from the steps above is the better tool.",
      ],
    },
    sections: [
      {
        id: "gitdiagram-limits",
        heading: "What a whole-repository diagram can and can't show",
        paragraphs: [
          "GitDiagram diagrams a whole repository with at most 34 parts. In a monorepo with hundreds of packages that makes it a top-level map: which apps and services exist and how they connect. It does not list every package, and a link to a folder inside the repository opens the diagram of the whole repository, not of that folder.",
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question:
          "I just joined a team with a huge monorepo. What's the fastest way to understand its architecture?",
        answer:
          "Read the workspace definition to see every package, draw the package graph with the repository's build tool (`nx graph`, `turbo run build --graph`, `bazel query`), get a runtime overview from the architecture docs or a generated diagram, and then focus on the one app you work on and its dependencies.",
      },
      {
        question: "Can GitDiagram diagram one package inside a monorepo?",
        answer:
          "Not on its own today: it diagrams the whole repository. For one package, use the monorepo's own graph tool, or ask a coding agent in your checkout to draw that package.",
      },
    ],
    sources: [
      SOURCES.nxGraph,
      SOURCES.turboRun,
      SOURCES.bazelQuery,
      SOURCES.pnpmWorkspaces,
      SOURCES.codeOwners,
    ],
  },
  {
    slug: "readme-architecture-diagram",
    label: "Add an architecture diagram to your README",
    title: "How to add an architecture diagram to your GitHub README",
    metaTitle: "Add an Architecture Diagram to Your GitHub README",
    description:
      "GitHub renders Mermaid in Markdown, so a README diagram can be text that changes with your code. Generate a first draft from your repository, trim it, paste it, keep it current.",
    answer:
      "The easiest way to put an architecture diagram in a GitHub README is a Mermaid code block: GitHub draws any code block marked `mermaid` as a diagram, so the diagram lives in the README as text and changes with the code in pull requests. You don't have to write it from scratch: open your repository on GitDiagram (replace `hub` with `diagram` in its URL), choose Export, then Copy Mermaid, and paste the code into a `mermaid` block. Or choose README picture for a picture of the diagram that opens the interactive version and updates whenever the diagram does.",
    stepsHeading: "Step by step",
    steps: [
      {
        name: "Make the diagram",
        text: "Open `gitdiagram.com/{owner}/{repo}` for your repository. For a private repository, give it read access first ([how](/guides/private-repository-diagram)).",
      },
      {
        name: "Pick the form",
        text: "Export offers four. Copy Mermaid gives editable text that GitHub renders and that shows up in diffs. README picture copies Markdown for an image at `gitdiagram.com/{owner}/{repo}/diagram.png` that links to the interactive diagram and follows the latest diagram. Download PNG gives a fixed image to commit. README badge copies a small badge that opens the diagram.",
      },
      {
        name: "Trim it for readers",
        text: "A README diagram is for someone deciding whether and where to contribute, so keep the groups and the main path and drop the rest. Rename boxes to the words your team uses. The exported code links each box to its file with `click` lines; keep or delete them.",
      },
      {
        name: "Paste it",
        text: "Put the code between a line with three backticks and `mermaid`, and a closing line of three backticks, usually under an Architecture heading. GitHub renders it in the README, issues, pull requests and wikis.",
      },
      {
        name: "Keep it current",
        text: "Edit the Mermaid in the pull request that changes the architecture, or regenerate the diagram after a big change. A README picture updates by itself when the diagram is regenerated.",
      },
    ],
    example: {
      repo: "ahmedkhaleel2004/gitdiagram",
      heading: "Example: GitDiagram's own README diagram",
      paragraphs: [
        "[GitDiagram's diagram of its own repository](/ahmedkhaleel2004/gitdiagram) has 26 parts in 5 groups (Diagram experience, Diagram generation, Repository browsing, Explainer videos, Sponsorship) and 18 connections. For a README you would keep one group, as in the trimmed excerpt below: the exported code, with the other groups and the `click` and styling lines removed.",
      ],
      code: {
        caption:
          "README.md: a trimmed excerpt of the exported Mermaid for ahmedkhaleel2004/gitdiagram",
        text: [
          "## Architecture",
          "",
          "```mermaid",
          "flowchart TD",
          'subgraph group_generation["Diagram generation"]',
          '  node_stream_api["Generation stream<br/>[route.ts]"]',
          '  node_admission["Request admission"]',
          '  node_github_ingest["GitHub ingestion<br/>[github.ts]"]',
          '  node_source_context["Source context<br/>[source-context.ts]"]',
          '  node_model_stream["Model streaming<br/>[openai.ts]"]',
          '  node_graph_compile["Graph compilation<br/>[graph.ts]"]',
          "end",
          'node_stream_api -->|"admits request"| node_admission',
          'node_stream_api -->|"fetches repository"| node_github_ingest',
          'node_stream_api -->|"fetches sources"| node_source_context',
          'node_stream_api -->|"streams completion"| node_model_stream',
          'node_stream_api -->|"compiles graph"| node_graph_compile',
          "```",
        ].join("\n"),
      },
    },
    sections: [
      {
        id: "other-ways",
        heading: "Other ways to make a README diagram",
        paragraphs: [
          "Writing the [Mermaid](/compare/mermaid) yourself gives full control and needs no tool at all. draw.io and Excalidraw are better for a hand-designed picture, saved as an image in the repository. [Structurizr](/compare/structurizr) keeps a C4 model as code when a team wants a maintained, formal architecture. GitHub Next's repo-visualizer Action draws an SVG of the folder structure on every push, but it shows files and sizes, not architecture, and the repository is archived.",
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question:
          "How can I add a professional-looking architecture diagram to my portfolio project on GitHub?",
        answer:
          "Generate a first draft from the repository, then trim it to a few groups with clear names and labeled arrows on the main path, and paste it as a Mermaid block under an Architecture heading. A reader should understand what the project does from the boxes alone.",
      },
      {
        question: "Does GitHub render Mermaid diagrams in a README?",
        answer:
          "Yes. A code block fenced with `mermaid` in a Markdown file, issue, pull request or wiki is drawn as a diagram.",
      },
    ],
    sources: [
      SOURCES.mermaidOnGitHub,
      SOURCES.mermaid,
      SOURCES.repoVisualizer,
      SOURCES.c4,
    ],
  },
  {
    slug: "private-repository-diagram",
    label: "Diagram a private repository",
    title: "How to get an architecture diagram of a private GitHub repository",
    metaTitle: "Architecture Diagram of a Private GitHub Repo",
    description:
      "Give read-only access to just the repositories you choose, with GitHub sign-in or a fine-grained token, and get a private interactive diagram. What is sent where, and how to revoke it.",
    answer:
      "To diagram a private GitHub repository, give the tool read-only access to that repository and nothing else. On GitDiagram, choose Private Repos in the header, then Continue with GitHub and pick only the repositories it may read, or paste a fine-grained personal access token limited to that repository with Contents set to Read-only. The diagram is stored privately and can be read only with the same access. If the code must not be sent to any outside service, use a tool that runs on your own machine instead.",
    stepsHeading: "Step by step",
    steps: [
      {
        name: "Open GitHub access",
        text: "Choose Private Repos in GitDiagram's header. It offers two ways in: signing in with GitHub, or a token.",
      },
      {
        name: "Grant read access to only what you need",
        text: "Continue with GitHub gives GitDiagram read-only access to only the repositories you pick, and you can remove it at any time in your GitHub settings. With a token instead, use Create token on GitHub: it opens GitHub's fine-grained token page with the name, a 30-day expiry and Contents: Read-only already filled in; choose the owner and select the repository. Metadata read access is added by GitHub automatically. An organization may need its admin to approve the token.",
      },
      {
        name: "Make the diagram",
        text: "Open `gitdiagram.com/{owner}/{repo}` as you would for a public repository. To make the diagram, the file tree, the README and up to 12 source files are sent to the AI provider that writes it.",
      },
      {
        name: "Know where it is kept",
        text: "Your sign-in or token is kept in a protected browser cookie for up to 30 days and sent with your own requests; it is never saved on GitDiagram's servers. The diagram is stored in a separate private location that only the same access can read. It does not appear in Browse, in the Markdown pages for agents or in the MCP server, which serve public repositories only.",
      },
      {
        name: "Remove access when you're done",
        text: "Disconnect in the same dialog, and revoke the token or the app's authorization in your GitHub settings.",
      },
    ],
    example: {
      repo: "expressjs/express",
      heading: "What you get",
      paragraphs: [
        "A private repository's diagram looks and works like any public one, such as [Express's](/expressjs/express): 16 parts in 5 groups with 22 labeled connections, each part linked to its file on GitHub, a written overview, and Export for PNG or Mermaid. Only the link to it stays private.",
      ],
    },
    sections: [
      {
        id: "keep-code-local",
        heading: "When the code can't leave your machine",
        paragraphs: [
          "Import-graph tools run entirely on your computer: [dependency-cruiser](/compare/dependency-cruiser) or [Madge](/compare/madge) for JavaScript and TypeScript, `pydeps` for Python, and the dependency diagrams in JetBrains IDEs. They show every import rather than an overview, but nothing is uploaded. Coding agents such as Claude Code or Copilot can draw a diagram from your checkout too, though they send code to their own model provider.",
          "GitDiagram is open source under the MIT license, so a team can also run it on its own infrastructure with its own AI provider key, and choose where the code goes.",
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question: "Does GitDiagram store my GitHub token?",
        answer:
          "No. It is kept in a protected cookie in your browser for up to 30 days and sent only with your own requests; it is never saved on GitDiagram's servers.",
      },
      {
        question: "Can other people see my private repository's diagram?",
        answer:
          "No. It is stored apart from public diagrams and can be read only with the same GitHub access that made it. It is not listed in Browse or served to agents.",
      },
    ],
    sources: [SOURCES.pat, SOURCES.appAuthorizations, SOURCES.gitdiagramSource],
  },
  {
    slug: "legacy-codebase",
    label: "Understand and document a legacy codebase",
    title: "How to understand and document a legacy codebase",
    metaTitle: "How to Understand and Document a Legacy Codebase",
    description:
      "Inherited a codebase with no docs, or a contractor's handoff? Map it, find the entry points and data, read the history, pin behavior with tests, and write the architecture down where it stays current.",
    answer:
      "With a legacy codebase and no documentation, work from the outside in: get a map of the main parts, find where execution starts and what data it keeps, read the history before the code, and write down what you learn as you go. A diagram generated from the repository is a fast first map; for a GitHub repository, replace `hub` with `diagram` in its URL. Before you change anything, get an exact import graph and tests that pin the current behavior, because a generated map simplifies.",
    stepsHeading: "A workflow that holds up",
    steps: [
      {
        name: "Get a first map",
        text: "Open the repository's diagram and its overview. The Markdown version (add `.md` to the page URL) also lists the main entry points and, for each connection, the file it was read from.",
      },
      {
        name: "Find where it starts and what it stores",
        text: "Look for the entry points (a `main`, the server setup, route tables, scheduled jobs) and for the data: the database schema and migrations usually describe the business better than any comment.",
      },
      {
        name: "Read the history",
        text: "`git log --follow <file>` shows how a file got here, and `git blame` shows which commit wrote a line; the commit messages and linked issues often explain the odd parts.",
      },
      {
        name: "Get exact dependencies before you refactor",
        text: "A generated diagram is a map, not a proof. Before moving code, draw the real import graph with dependency-cruiser or Madge (JavaScript), `pydeps` (Python) or your IDE, and add rules in CI that stop new cycles.",
      },
      {
        name: "Pin the behavior with tests",
        text: "Write tests that record what the code does today, right or wrong, around the part you will change. They tell you when a refactor changed behavior.",
      },
      {
        name: "Write the architecture down next to the code",
        text: "Commit a `docs/architecture.md` with a Mermaid diagram (the exported code is a first draft to correct), or a [C4 model](https://c4model.com) for something more formal. To keep a README picture from going stale, use GitDiagram's README picture: it shows the latest diagram after each regeneration.",
      },
    ],
    example: {
      repo: "django/django",
      heading: "Example: a 20-year-old codebase",
      paragraphs: [
        "Django has been developed in public since 2005, which makes it a good stand-in for a large, layered codebase. [Its diagram](/django/django) (made 2026-10-28) has 26 parts in 5 groups (Framework runtime, Data and ORM, Web presentation, Built-in applications, Geospatial support) and 19 connections. It traces the ORM chain from the model manager (`django/db/models/manager.py`) to the QuerySet API (`query.py`) to the SQL query builder (`sql/query.py`), and shows that the admin builds its queries through the QuerySet API (`django/contrib/admin/views/main.py`).",
        "Each of those connections names the file it was read from, so you can check it in a minute. The overview also says which connections it left out because the sampled files did not show them; those are the places to read next.",
      ],
    },
    sections: [
      {
        id: "other-tools",
        heading: "When another tool fits better",
        paragraphs: [
          "For a written explanation of each part, [DeepWiki](/compare/deepwiki) generates a wiki of public repositories. For exact answers across a large codebase, such as every caller of a function, use [Sourcegraph](/compare/sourcegraph) or your IDE. For a maintained, formal model the team owns, [Structurizr](/compare/structurizr) keeps C4 diagrams as code.",
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question:
          "I inherited a legacy codebase with no documentation. Where do I start?",
        answer:
          "Get a generated map of the main parts, find the entry points and the database schema, read the history with `git log` and `git blame`, and write tests around anything you plan to change before you change it.",
      },
      {
        question:
          "Our architecture docs are always out of date. Can the diagram come from the code?",
        answer:
          "Yes. GitDiagram generates the diagram from the repository, and its README picture always shows the latest diagram; regenerate it after a big change. Keep any hand-written explanation next to it in the repository so it is reviewed with the code.",
      },
    ],
    sources: [
      SOURCES.gitLog,
      SOURCES.gitBlame,
      SOURCES.dependencyCruiser,
      SOURCES.pydeps,
      SOURCES.c4,
    ],
  },
  {
    slug: "review-an-unfamiliar-pull-request",
    label: "Review a pull request in an unfamiliar codebase",
    title: "How to review a pull request in a codebase you don't know",
    metaTitle: "Review a Pull Request in an Unfamiliar Codebase",
    description:
      "Place the changed files on a map of the repository first, then read the description, the tests, the change and its neighbors. A worked example on a real FastAPI pull request.",
    answer:
      "Before reviewing a big pull request in a repository you don't know, find out where it sits: open an architecture map of the repository, mark which parts the changed files belong to, and note what those parts connect to. Then read the description and the tests first, the core change next, and the code around it last. For a GitHub repository the map is at `gitdiagram.com/{owner}/{repo}`; each part links to its files, so matching the pull request's file list to parts takes a minute.",
    stepsHeading: "Step by step",
    steps: [
      {
        name: "Read the description and the linked issue",
        text: "Know what behavior should change, and why, before you look at a line of code.",
      },
      {
        name: "Place the changed files on the map",
        text: "Open the repository's diagram next to the pull request's file list and mark the parts that changed. The connections into and out of those parts are what the change can break.",
      },
      {
        name: "Read the tests first",
        text: "They state the intended behavior in the project's own terms, and missing tests show where to look hardest.",
      },
      {
        name: "Read the core change, then its neighbors",
        text: "Use go-to-definition and find-references, in your editor or with GitHub's code navigation, to check the callers and the parts the map shows next to the change.",
      },
      {
        name: "Run it",
        text: "`gh pr checkout <number>` checks the pull request out locally; run the tests and try the behavior yourself.",
      },
      {
        name: "Ask the owners",
        text: "A `CODEOWNERS` file says who reviews each folder. Ask them about anything the map or the description leaves unclear.",
      },
    ],
    example: {
      repo: "fastapi/fastapi",
      heading: "Example: a FastAPI pull request",
      paragraphs: [
        `[FastAPI pull request #16594](${FASTAPI_PR}), "Apply each parameter model's \`extra\` configuration to sibling fields", merged on 2026-10-22, changes 17 files (+823, −495): 3 source files, 8 test files, 5 documentation files and \`pyproject.toml\`.`,
        'On [FastAPI\'s diagram](/fastapi/fastapi), two of the three source files are parts of their own: `fastapi/dependencies/utils.py` is Dependency solving and `fastapi/routing.py` is Route dispatch (`fastapi/dependencies/models.py` sits in the same folder as Dependency solving). The diagram connects them: Route dispatch "resolves inputs" through Dependency solving, which "interprets declarations" from Parameter declarations (`params.py`) and "validates fields" through Model compatibility. So the change sits on every request\'s path between routing and validation: the places to check are how query, header, cookie and form parameter models are validated, which is exactly what the test file names cover.',
      ],
    },
    sections: [
      {
        id: "other-tools",
        heading: "Other tools that help",
        paragraphs: [
          'GitHub\'s own review view lets you filter files, mark them viewed and comment line by line. A coding agent in your checkout can answer narrow questions about the change, such as "what else calls this function?". [Sourcegraph](/compare/sourcegraph) finds every use of a symbol across repositories.',
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question:
          "I have to review a big pull request in a repo I don't know. How do I see how the pieces fit together first?",
        answer:
          "Open an architecture diagram of the repository, mark the parts the changed files belong to, and look at what those parts connect to. Then read the description, the tests and the change in that order.",
      },
    ],
    sources: [
      SOURCES.reviewingPrs,
      SOURCES.ghPrCheckout,
      SOURCES.navigatingCode,
      SOURCES.codeOwners,
      { label: "fastapi/fastapi pull request #16594", url: FASTAPI_PR },
    ],
  },
  {
    slug: "technical-interview-codebase-prep",
    label: "Study a company's codebase before an interview",
    title: "How to study a company's codebase before a technical interview",
    metaTitle: "Study a Company's Codebase Before an Interview",
    description:
      "If the company's code is on GitHub, learn the product's shape: the main parts, the main path, what the team is changing now and how they review. Then bring specific questions.",
    answer:
      "If the company has public GitHub repositories, learn the shape of the product rather than its code: the main parts, how a request or job flows through them, what the team is working on now, and how they review changes. An architecture diagram gives you the first two in minutes (replace `hub` with `diagram` in the repository's URL); recent pull requests, issues and the contributing guide give you the rest. Then prepare two or three specific questions from what you saw.",
    stepsHeading: "How to prepare",
    steps: [
      {
        name: "Find the main repository",
        text: "Start from the company's GitHub organization and its pinned repositories; the product's main repository usually has the most stars and recent activity.",
      },
      {
        name: "Get the map",
        text: "Open its diagram and overview. Aim to explain, in three sentences, what the main parts are and how a typical request or job moves through them.",
      },
      {
        name: "Read what the team is changing now",
        text: "Recently merged pull requests (search `is:pr is:merged`) and open issues show current priorities, the review style and how much testing is expected.",
      },
      {
        name: "Run it if you can",
        text: "Follow the README or contributing guide to start it locally. Whatever was hard to set up is a fair thing to mention.",
      },
      {
        name: "Prepare questions, and be honest about depth",
        text: "Turn what you saw into questions (\"how do these two parts share work?\"). Say you studied the public repository; don't claim to know internals you haven't seen.",
      },
    ],
    example: {
      repo: "n8n-io/n8n",
      heading: "Example: n8n",
      paragraphs: [
        "[n8n's diagram](/n8n-io/n8n) (made 2026-11-05) has 25 parts in 5 groups (Workflow authoring, Execution and AI, Integrations and services, Operations and governance, Apps and clients) and 17 connections. The main path is short enough to say out loud: someone designs a workflow in the visual editor (`packages/frontend/editor-ui/src`), the execution engine (`packages/@n8n/engine`) runs it, and the engine executes integration nodes (`packages/nodes-base/nodes`) against connected services.",
        'The map also points at a good question. The agent runtime (`packages/@n8n/agents`) connects to model adapters, tools, memory, guardrails and streaming, but the diagram shows no connection between it and the execution engine, because the sampled files did not show one. "How does the agent runtime relate to the workflow engine?" is a specific, informed question to bring.',
      ],
    },
    sections: [
      {
        id: "other-tools",
        heading: "Other tools that help",
        paragraphs: [
          "[DeepWiki](/compare/deepwiki) writes a longer explanation of popular public repositories, with a chat for follow-up questions. GitHub's code navigation lets you read without cloning. If the company's code is private, its engineering blog, conference talks and public API docs are the next best map.",
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question:
          "I have a technical interview at a company with public GitHub repos. How can I understand their architecture quickly?",
        answer:
          "Open an architecture diagram of their main repository, learn the main parts and the main path, skim recently merged pull requests and open issues, and prepare a few specific questions from what you saw.",
      },
    ],
    sources: [SOURCES.searchPrs, SOURCES.contributing, SOURCES.navigatingCode],
  },
  {
    slug: "github-repo-visualizer",
    label: "GitHub repo visualizers",
    title: "GitHub repo visualizer: which kind you need, and how to get it",
    metaTitle: "GitHub Repo Visualizer: Architecture, Files, History",
    description:
      "A GitHub repo visualizer can show the architecture, the folder structure, the commit history or the dependencies. Which tool draws each, in the browser or locally, with a real example.",
    answer:
      "A GitHub repo visualizer can mean four different pictures. For the architecture, the main parts and how they connect, replace `hub` with `diagram` in the repository's URL: GitDiagram shows an interactive diagram in your browser, free, with nothing to install or clone. For the commit history and branches, use `git log --graph` or Gource. For the folder structure, a treemap or circle-packing picture such as GitHub Next's repo-visualizer Action (now archived). For package dependencies, GitHub's dependency graph or an import-graph tool such as dependency-cruiser.",
    stepsHeading: "The four kinds, and what draws each",
    steps: [
      {
        name: "Architecture: the main parts and how they connect",
        text: "Change `github.com/owner/repo` to `gitdiagram.com/owner/repo`, or paste the URL on the [home page](/). The diagram groups the main components, labels the connections and links each part to its code. Good for understanding a project you have never seen.",
      },
      {
        name: "History: commits and branches",
        text: "`git log --graph --oneline --all` draws the branch graph in a terminal, and most Git clients draw it too. Gource turns a repository's history into an animation of who changed what over time.",
      },
      {
        name: "Structure: folders and file sizes",
        text: "GitHub Next's repo-visualizer was a GitHub Action that drew the folder tree as an SVG on every push; it still works as an example but the repository is archived. GitHub's own file browser and `tree` in a terminal are the plain versions.",
      },
      {
        name: "Dependencies: packages and imports",
        text: "GitHub's dependency graph lists the packages a repository depends on, from its manifests and lockfiles. For the imports between your own modules, run [dependency-cruiser](/compare/dependency-cruiser) or [Madge](/compare/madge) for JavaScript, or `pydeps` for Python.",
      },
    ],
    example: {
      repo: "facebook/react",
      heading: "Example: React's repository as an architecture diagram",
      paragraphs: [
        "[React's diagram](/facebook/react) (made 2026-10-05) has 21 parts in 4 groups and 17 connections. The runtime path goes from components (`packages/react`) to the React DOM API and the Fiber reconciler, which updates the browser UI; server rendering and React Server Components sit beside it. The largest group is the React Compiler, a pipeline from the Babel plugin through HIR construction, mutation inference and reactive scopes, with a Rust compiler pipeline under `compiler/crates`. That split, a runtime and a compiler in one repository, is the first thing a newcomer needs and the hardest to see from the folder tree.",
      ],
    },
    sections: [
      {
        id: "compare",
        heading: "Comparing the tools",
        paragraphs: [
          "The [codebase visualization tools roundup](/best-codebase-visualization-tools) compares GitDiagram, DeepWiki, Sourcegraph, dependency-cruiser, Madge, pydeps, Mermaid, PlantUML, Structurizr and coding agents, with each one's price and limits.",
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question:
          "Is there a site where you change the GitHub URL to see a diagram of the repo?",
        answer:
          "Yes. Replace `hub` with `diagram` in the URL: `github.com/facebook/react` becomes `gitdiagram.com/facebook/react`.",
      },
      {
        question: "Can I visualize a GitHub repository without cloning it?",
        answer:
          "Yes. GitDiagram reads the repository through GitHub and shows the diagram in your browser. History and import-graph tools usually need a local clone.",
      },
    ],
    sources: [
      SOURCES.gitLog,
      SOURCES.gource,
      SOURCES.repoVisualizer,
      SOURCES.dependencyGraph,
      SOURCES.dependencyCruiser,
    ],
  },
  {
    slug: "architecture-map-for-ai-coding-agents",
    label: "Give an AI coding agent a map of your repo",
    title: "How to give an AI coding agent a map of your repository",
    metaTitle: "Give Your AI Coding Agent a Map of Your Repo",
    description:
      "Agents get lost because each session starts knowing nothing about your layout. Give them a short written map in CLAUDE.md, AGENTS.md or a Cursor rule, generated from the repository, or an MCP server.",
    answer:
      "Coding agents get lost in large repositories because each session starts without knowing how the code is organized. Give them a short written map they load every time: a `CLAUDE.md` for Claude Code, an `AGENTS.md` for Codex and other agents, or a Cursor rule, naming the main parts, where they live and how they connect. To write it quickly, start from a generated architecture diagram: GitDiagram's Markdown version (`gitdiagram.com/{owner}/{repo}.md`) lists every part with its path and every connection, and its free MCP server lets an agent fetch the diagram itself.",
    stepsHeading: "Step by step",
    steps: [
      {
        name: "Generate the map",
        text: "Open `gitdiagram.com/{owner}/{repo}.md` for a public repository. It has the overview, the main entry points, the Mermaid source, every part with its GitHub link, and every connection.",
      },
      {
        name: "Put the essentials in the agent's instructions",
        text: "Claude Code reads `CLAUDE.md` (its `/init` command writes a first one by exploring the code); Codex and many other agents read `AGENTS.md`; Cursor reads rules from `.cursor/rules`. Add the main parts with their paths and the main path between them, in a few short lines. A long file costs context in every session.",
      },
      {
        name: "Or let the agent fetch the diagram",
        text: "Connect GitDiagram's MCP server: `claude mcp add --transport http gitdiagram https://gitdiagram.com/mcp` in Claude Code, `codex mcp add gitdiagram --url https://gitdiagram.com/mcp` in Codex, or a `gitdiagram` entry with that URL in Cursor's `mcp.json`. Its tools are `get_repository_diagram`, `find_repository_diagrams` and `get_explainer_video`; no sign-in, public repositories only.",
      },
      {
        name: "Ask the agent for focused views",
        text: "For one request path or one feature, ask the agent in your checkout to draw a Mermaid diagram. It can read every file, which a whole-repository map can't.",
      },
      {
        name: "Keep the map current",
        text: "Update the instructions file in the pull request that changes the architecture, or regenerate the diagram after a big refactor.",
      },
    ],
    example: {
      repo: "openai/codex",
      heading: "Example: what an agent gets for openai/codex",
      paragraphs: [
        "Calling `get_repository_diagram` for [openai/codex](/openai/codex) (on 2026-11-09) returned the stored diagram from 2026-11-06: 16 parts in 4 groups (CLI and sessions, Agent runtime, Tools and extensions, User interfaces) and 15 connections, each part with its path. An excerpt of the Mermaid it returned is below. Several arrows are dashed. In GitDiagram's diagrams a dashed arrow means optional or inferred: strongly implied but not shown in the files that were read. An agent should treat those as hints to check, not facts.",
      ],
      code: {
        caption:
          "An excerpt of the Mermaid returned by get_repository_diagram for openai/codex",
        text: [
          "flowchart TD",
          'subgraph group_entry["CLI and sessions"]',
          '  node_cli["CLI entry<br/>[main.rs]"]',
          '  node_thread["Thread manager<br/>[thread_manager.rs]"]',
          "end",
          'subgraph group_agent["Agent runtime"]',
          '  node_session["Session runtime<br/>[session.rs]"]',
          '  node_model["Model provider<br/>[client_auth.rs]"]',
          '  node_sandbox["Sandbox policy<br/>[manager.rs]"]',
          "end",
          'node_user -->|"starts"| node_cli',
          'node_cli -.->|"starts session"| node_thread',
          'node_thread -.->|"manages"| node_session',
          'node_session -.->|"requests model"| node_model',
          'node_session -.->|"applies policy"| node_sandbox',
          'node_session -.->|"uses tools"| node_mcp_runtime',
        ].join("\n"),
      },
    },
    sections: [
      {
        id: "private-code",
        heading: "Private repositories",
        paragraphs: [
          "The Markdown pages and the MCP server serve public repositories only. For a private one, make the diagram with [GitHub access](/guides/private-repository-diagram), copy its Mermaid and overview into your instructions file, and edit them down to what the agent needs.",
          LIMITS,
        ],
      },
    ],
    questions: [
      {
        question:
          "My AI coding agent keeps getting lost in our codebase. How can I give it a map of the architecture?",
        answer:
          "Put a short map in the file your agent loads every session (`CLAUDE.md`, `AGENTS.md` or a Cursor rule): the main parts, their paths and how they connect. Generate a first draft from the repository, for example from `gitdiagram.com/{owner}/{repo}.md`, and trim it.",
      },
      {
        question:
          "Is there an MCP server that gives AI assistants an architecture diagram of a GitHub repository?",
        answer:
          "Yes. GitDiagram's read-only server at `https://gitdiagram.com/mcp` (streamable HTTP, no sign-in) returns the stored diagram of a public repository with `get_repository_diagram`.",
      },
    ],
    sources: [
      SOURCES.claudeMemory,
      SOURCES.claudeMcp,
      SOURCES.agentsMd,
      SOURCES.cursorRules,
      SOURCES.mcp,
    ],
  },
];

export function situationPage(slug: string): SituationPage | undefined {
  return SITUATION_PAGES.find((page) => page.slug === slug);
}
