import type { Metadata } from "next";

import { TextPage, type TextPageSection } from "~/components/text-page";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with GitDiagram, its MCP server and the GitDiagram plugin for ChatGPT and Codex.",
  alternates: { canonical: "/support" },
};

const sections: TextPageSection[] = [
  {
    heading: "Contact",
    body: [
      "Email ahmed@gitdiagram.com with the repository and what went wrong; you'll get an answer from the person who builds GitDiagram. Bugs and feature requests are also welcome as issues at github.com/ahmedkhaleel2004/gitdiagram.",
    ],
  },
  {
    heading: "Using GitDiagram in ChatGPT and Codex",
    body: [
      'Add the GitDiagram plugin, then ask about a public GitHub repository, for example "Show me the architecture of fastapi/fastapi". In ChatGPT the diagram appears in the conversation: drag to move it, pinch or use the buttons to zoom, choose Expand for full screen, and click a component to open its code on GitHub.',
      "The plugin reads diagrams GitDiagram has already made. If a repository has none yet, open the link it gives you: gitdiagram.com makes the diagram in about a minute, and the plugin can read it after that. The plugin works with public repositories only and needs no account.",
    ],
  },
  {
    heading: "Other AI assistants",
    body: [
      "Any MCP client can connect to gitdiagram.com/mcp (streamable HTTP, no sign-in). In Claude Code: claude mcp add --transport http gitdiagram https://gitdiagram.com/mcp. In Codex: codex mcp add gitdiagram --url https://gitdiagram.com/mcp.",
    ],
  },
  {
    heading: "Common questions",
    body: [
      "“Too many GitDiagram requests”: each person and network has an hourly allowance; wait a few minutes and try again.",
      "Privacy and deletion requests: see gitdiagram.com/privacy, or email ahmed@gitdiagram.com.",
    ],
  },
];

export default function SupportPage() {
  return (
    <TextPage
      title="Support"
      updated="September 29, 2026"
      sections={sections}
    />
  );
}
