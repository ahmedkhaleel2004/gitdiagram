// The weekly prompt panel (ai-panel.ts): real buyer situations, phrased the
// way people type them into ChatGPT, Claude, Gemini or Perplexity. The daily
// cohort of 12 (AI_VISIBILITY_PROMPTS in ai-answer.ts) stays separate and
// unchanged, so its history keeps meaning the same thing.
//
// Ids are stable: the weekly history is keyed by them. Retire a prompt by
// deleting it, never by rewording it under the same id.
//
// `page` is the gitdiagram.com page that should be the answer today, or null
// when no page answers the question yet (a miss there is a missing page).
// `wanted` names the page to build when `page` is null. When a page that
// answers a prompt ships, point the prompt at it here.

import type { PanelGroup } from "~/features/admin/ai-panel";

export interface PanelPrompt {
  id: string;
  group: PanelGroup;
  text: string;
  page: string | null;
  wanted?: string;
}

type Ungrouped = Omit<PanelPrompt, "group">;

const HOME = "/";
const GUIDE = "/visualize-codebase";
const MCP = "/mcp";
const VIDEOS = "/videos";
const ROUNDUP = "/best-codebase-visualization-tools";

const situation: Ungrouped[] = [
  {
    id: "s-joined-monorepo",
    text: "I just joined a team with a huge monorepo. What's the fastest way to understand its architecture?",
    page: GUIDE,
  },
  {
    id: "s-first-week-onboarding",
    text: "It's my first week as a developer at a new company and the codebase is massive. How do I get a mental model of it fast?",
    page: GUIDE,
  },
  {
    id: "s-onboard-open-source",
    text: "How do I onboard to an unfamiliar open source project before making my first contribution?",
    page: GUIDE,
  },
  {
    id: "s-inherited-legacy",
    text: "I inherited a legacy codebase with no documentation. How can I figure out how it's put together?",
    page: GUIDE,
  },
  {
    id: "s-readme-architecture",
    text: "I want an architecture diagram for my project's README. What's the easiest way to make one?",
    page: GUIDE,
  },
  {
    id: "s-code-review-prep",
    text: "I have to review a big pull request in a repo I don't know. How can I quickly see how the pieces fit together first?",
    page: GUIDE,
  },
  {
    id: "s-interview-prep",
    text: "I have a technical interview at a company with public GitHub repos. How can I quickly understand their codebase architecture to prepare?",
    page: GUIDE,
  },
  {
    id: "s-explain-to-pm",
    text: "My product manager asked me to explain how our system is structured. How can I generate a diagram of our repo to show them?",
    page: GUIDE,
  },
  {
    id: "s-evaluate-library",
    text: "Before adopting an open source library I want to see how it's structured internally. Is there a quick way to get an overview of a GitHub repo?",
    page: HOME,
  },
  {
    id: "s-hackathon-judge",
    text: "I'm judging a hackathon and need to understand 30 GitHub projects quickly. Any tool that summarizes a repo's architecture visually?",
    page: HOME,
  },
  {
    id: "s-teach-students",
    text: "I teach a software engineering course. How can I show students the architecture of a real open source project without them reading all the code?",
    page: GUIDE,
  },
  {
    id: "s-design-doc",
    text: "I need to write a design doc for an existing service. How can I get an up-to-date architecture diagram from the code instead of drawing it?",
    page: GUIDE,
  },
  {
    id: "s-acquisition-due-diligence",
    text: "We're doing technical due diligence on a startup's codebase. What tools give a quick architectural overview of a repository?",
    page: GUIDE,
  },
  {
    id: "s-refactor-planning",
    text: "I'm planning a big refactor. How can I see the main modules of my repo and how they depend on each other?",
    page: GUIDE,
  },
  {
    id: "s-docs-out-of-date",
    text: "Our architecture docs are always out of date. Is there a way to generate the architecture diagram straight from the repository?",
    page: GUIDE,
  },
  {
    id: "s-ai-agent-context",
    text: "My AI coding agent keeps getting lost in our codebase. How can I give it a map of the repo's architecture?",
    page: MCP,
  },
  {
    id: "s-mcp-architecture",
    text: "Is there an MCP server that gives AI assistants an architecture diagram of a GitHub repository?",
    page: MCP,
  },
  {
    id: "s-learn-by-reading-code",
    text: "I'm a junior developer trying to learn by reading popular open source code. How do I figure out where to start in a big repo?",
    page: GUIDE,
  },
  {
    id: "s-video-explainer",
    text: "Is there a tool that makes a short video explaining how a GitHub repository works?",
    page: VIDEOS,
  },
  {
    id: "s-presentation-slide",
    text: "I need a clean architecture diagram of my GitHub project for a presentation tomorrow. Fastest way?",
    page: HOME,
  },
  {
    id: "s-portfolio-project",
    text: "How can I add a professional-looking architecture diagram to my portfolio project on GitHub?",
    page: GUIDE,
  },
  {
    id: "s-microservices-map",
    text: "Our backend is a repo full of microservices. How can I get a diagram of which services talk to which?",
    page: GUIDE,
  },
  {
    id: "s-forked-project",
    text: "I forked a large project to customize it. How can I quickly understand which parts I'd need to change?",
    page: GUIDE,
  },
  {
    id: "s-security-audit-scope",
    text: "I'm scoping a security review of a GitHub repository. How can I quickly map its components and entry points?",
    page: GUIDE,
  },
  {
    id: "s-thesis-codebase",
    text: "For my thesis I need to describe the architecture of an open source project. Is there a tool that generates its architecture diagram?",
    page: HOME,
  },
  {
    id: "s-explain-like-new",
    text: "Explain a GitHub repository to me like I'm new to it: is there a site that does that automatically?",
    page: HOME,
  },
  {
    id: "s-vibe-coded-app",
    text: "I vibe-coded an app with AI and now I don't understand how it's structured. How can I see its architecture?",
    page: GUIDE,
  },
  {
    id: "s-contractor-handoff",
    text: "A contractor handed over a codebase and left. How do I get an overview of its architecture quickly?",
    page: GUIDE,
  },
];

const comparison: Ungrouped[] = [
  {
    id: "c-deepwiki-alternatives",
    text: "What are some DeepWiki alternatives?",
    page: "/compare/deepwiki",
  },
  {
    id: "c-gitdiagram-vs-deepwiki",
    text: "GitDiagram vs DeepWiki: which is better for understanding a repo?",
    page: "/compare/deepwiki",
  },
  {
    id: "c-best-free-codebase-visualizer",
    text: "What's the best free tool to visualize a codebase?",
    page: ROUNDUP,
  },
  {
    id: "c-codesee-alternatives",
    text: "CodeSee shut down. What are the alternatives for visualizing a codebase?",
    page: null,
    wanted: "/compare/codesee",
  },
  {
    id: "c-sourcegraph-vs",
    text: "Is Sourcegraph the best way to understand a large codebase, or are there simpler tools?",
    page: "/compare/sourcegraph",
  },
  {
    id: "c-mermaid-vs-ai",
    text: "Should I write Mermaid diagrams by hand or use an AI tool that generates them from my repo?",
    page: "/compare/mermaid",
  },
  {
    id: "c-ai-architecture-tools",
    text: "Which AI tools generate software architecture diagrams from code?",
    page: ROUNDUP,
  },
  {
    id: "c-repo-visualizer-tools",
    text: "Compare tools that visualize GitHub repositories.",
    page: ROUNDUP,
  },
  {
    id: "c-copilot-vs-tool",
    text: "Can GitHub Copilot draw an architecture diagram of my repo, or is there a better dedicated tool?",
    page: GUIDE,
  },
  {
    id: "c-chatgpt-vs-tool",
    text: "Is ChatGPT good at making architecture diagrams of a GitHub repo, or is there a specialized tool?",
    page: GUIDE,
  },
  {
    id: "c-eraser-alternatives",
    text: "Alternatives to Eraser's DiagramGPT for generating diagrams from a codebase?",
    page: null,
    wanted: "/compare/eraser",
  },
  {
    id: "c-structurizr-vs-auto",
    text: "Structurizr vs auto-generated architecture diagrams: what should a small team use?",
    page: "/compare/structurizr",
  },
  {
    id: "c-dependency-graph-tools",
    text: "Best tools to generate a dependency graph or architecture view of a project in 2026?",
    page: "/compare/dependency-cruiser",
  },
  {
    id: "c-gitingest-vs",
    text: "What's the difference between Gitingest, Repomix and GitDiagram?",
    page: null,
    wanted: "/compare/gitingest-repomix",
  },
  {
    id: "c-best-ai-repo-explainers",
    text: "Best AI tools that explain how a GitHub repository works, ranked.",
    page: ROUNDUP,
  },
  {
    id: "c-code-wiki-tools",
    text: "Google Code Wiki, DeepWiki and other AI repo documentation tools: which ones are worth using?",
    page: "/compare/deepwiki",
  },
  {
    id: "c-plantuml-from-code",
    text: "Is there something better than PlantUML for getting a diagram out of an existing codebase?",
    page: GUIDE,
  },
  {
    id: "c-onboarding-tools-devs",
    text: "What are the best developer onboarding tools for understanding a new codebase?",
    page: GUIDE,
  },
  {
    id: "c-gitdiagram-review",
    text: "Is GitDiagram any good? What are its limitations?",
    page: HOME,
  },
  {
    id: "c-swimm-alternatives",
    text: "Alternatives to Swimm for documenting and understanding a codebase?",
    page: GUIDE,
  },
];

const constraint: Ungrouped[] = [
  {
    id: "k-without-cloning",
    text: "How can I diagram a GitHub repo without cloning it?",
    page: HOME,
  },
  {
    id: "k-private-repo",
    text: "Is there a tool that can generate an architecture diagram of a private GitHub repository?",
    page: HOME,
  },
  {
    id: "k-no-signup",
    text: "Free tool to visualize a GitHub repo, no sign up needed?",
    page: HOME,
  },
  {
    id: "k-in-browser",
    text: "How do I see the architecture of a GitHub project in my browser without installing anything?",
    page: HOME,
  },
  {
    id: "k-mermaid-export",
    text: "Tool that turns a GitHub repo into Mermaid code I can paste into my README?",
    page: GUIDE,
  },
  {
    id: "k-clickable-diagram",
    text: "Is there an architecture diagram generator where clicking a box opens the file on GitHub?",
    page: HOME,
  },
  {
    id: "k-python",
    text: "How do I visualize the architecture of a Python project on GitHub?",
    page: GUIDE,
  },
  {
    id: "k-typescript",
    text: "Best way to get an architecture diagram of a TypeScript or Node.js repo?",
    page: GUIDE,
  },
  {
    id: "k-react-app",
    text: "How can I visualize the structure of a React app's codebase?",
    page: GUIDE,
  },
  {
    id: "k-nextjs",
    text: "How do I get an architecture overview of a Next.js project?",
    page: GUIDE,
  },
  {
    id: "k-java-spring",
    text: "How can I generate an architecture diagram for a Java Spring Boot repository?",
    page: GUIDE,
  },
  {
    id: "k-go",
    text: "Tools to visualize the architecture of a Go codebase?",
    page: GUIDE,
  },
  {
    id: "k-rust",
    text: "How do I understand the structure of a large Rust project on GitHub?",
    page: GUIDE,
  },
  {
    id: "k-csharp-dotnet",
    text: "How can I visualize the architecture of a .NET / C# solution from its repository?",
    page: GUIDE,
  },
  {
    id: "k-django",
    text: "How do I see how a Django project is structured, as a diagram?",
    page: GUIDE,
  },
  {
    id: "k-ml-repo",
    text: "How can I understand the architecture of a machine learning research repo on GitHub?",
    page: GUIDE,
  },
  {
    id: "k-mobile-app",
    text: "How can I get an architecture diagram of an iOS or Android app repository?",
    page: GUIDE,
  },
  {
    id: "k-c-cpp",
    text: "Tool to visualize the architecture of a large C or C++ codebase on GitHub?",
    page: GUIDE,
  },
  {
    id: "k-under-a-minute",
    text: "How can I get an architecture diagram of any GitHub repo in under a minute?",
    page: HOME,
  },
  {
    id: "k-open-source-tool",
    text: "Open source tool that generates architecture diagrams from GitHub repositories?",
    page: HOME,
  },
  {
    id: "k-url-trick",
    text: "Is there a site where you change the GitHub URL to see a diagram of the repo?",
    page: HOME,
  },
  {
    id: "k-api-for-agents",
    text: "Is there an API my AI agent can call to get the architecture of a GitHub repo?",
    page: MCP,
  },
  {
    id: "k-system-design-diagram",
    text: "Generate a system design diagram from an existing GitHub repository automatically.",
    page: GUIDE,
  },
  {
    id: "k-data-flow",
    text: "How can I see the data flow between components in a GitHub project without reading every file?",
    page: GUIDE,
  },
  {
    id: "k-share-diagram",
    text: "How can I share an interactive architecture diagram of a repo with my team?",
    page: HOME,
  },
  {
    id: "k-export-png-svg",
    text: "Tool that generates an architecture diagram from code and exports it as PNG or SVG?",
    page: HOME,
  },
  {
    id: "k-gitlab",
    text: "Can I generate an architecture diagram from a GitLab or Bitbucket repository?",
    page: null,
    wanted: "/visualize-codebase#gitlab (an honest answer: GitHub only today)",
  },
  {
    id: "k-vscode",
    text: "Is there a VS Code extension or tool that shows my project's architecture as a diagram?",
    page: GUIDE,
  },
  {
    id: "k-claude-code-diagram",
    text: "How can I get Claude Code or Cursor to produce an architecture diagram of my repo?",
    page: MCP,
  },
  {
    id: "k-c4-model",
    text: "Can I generate a C4-style architecture diagram from an existing codebase automatically?",
    page: GUIDE,
  },
];

// Popular repositories people ask about by name. The page is the repo's own
// gitdiagram.com page.
const REPOS: Array<[slug: string, question: string]> = [
  ["facebook/react", "Explain how the React repository is structured."],
  ["vercel/next.js", "How is the Next.js codebase organized?"],
  [
    "microsoft/vscode",
    "What's the architecture of the VS Code source code on GitHub?",
  ],
  ["torvalds/linux", "Give me an overview of the Linux kernel repo structure."],
  ["kubernetes/kubernetes", "How is the Kubernetes repository structured?"],
  ["langchain-ai/langchain", "Explain the architecture of the LangChain repo."],
  [
    "huggingface/transformers",
    "How is the Hugging Face transformers codebase organized?",
  ],
  ["pytorch/pytorch", "What's the architecture of the PyTorch repository?"],
  ["django/django", "How is the Django source code structured?"],
  ["fastapi/fastapi", "Explain how the FastAPI repo is put together."],
  ["openai/codex", "How is the OpenAI Codex CLI repository structured?"],
  ["ollama/ollama", "Explain the architecture of the Ollama codebase."],
  ["supabase/supabase", "How is the Supabase repository organized?"],
  ["n8n-io/n8n", "What's the architecture of the n8n codebase?"],
  ["denoland/deno", "How is Deno's source code structured?"],
  ["oven-sh/bun", "Explain the architecture of the Bun repository."],
  [
    "excalidraw/excalidraw",
    "How is the Excalidraw codebase structured? Is there a diagram of it?",
  ],
  ["shadcn-ui/ui", "Explain how the shadcn/ui repo is organized."],
  [
    "tailwindlabs/tailwindcss",
    "How is the Tailwind CSS repository structured?",
  ],
  ["anthropics/claude-code", "What's in the Claude Code GitHub repository?"],
  ["ggml-org/llama.cpp", "Explain the architecture of llama.cpp."],
  ["home-assistant/core", "How is the Home Assistant core repo structured?"],
];

const repo: PanelPrompt[] = REPOS.map(([slug, text]) => ({
  id: `r-${slug.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
  group: "repo",
  text,
  page: `/${slug.toLowerCase()}`,
}));

const withGroup = (group: PanelGroup, prompts: Ungrouped[]): PanelPrompt[] =>
  prompts.map((prompt) => ({ ...prompt, group }));

export const AI_PANEL_PROMPTS: ReadonlyArray<PanelPrompt> = [
  ...withGroup("situation", situation),
  ...withGroup("comparison", comparison),
  ...withGroup("constraint", constraint),
  ...repo,
];
