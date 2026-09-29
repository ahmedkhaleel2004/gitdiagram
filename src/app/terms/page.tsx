import type { Metadata } from "next";

import { TextPage, type TextPageSection } from "~/components/text-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using GitDiagram, its MCP server and plugin.",
  alternates: { canonical: "/terms" },
};

const sections: TextPageSection[] = [
  {
    heading: "What GitDiagram is",
    body: [
      "GitDiagram (gitdiagram.com) turns GitHub repositories into interactive architecture diagrams, written explanations and narrated explainer videos. The same diagrams are available to AI assistants through its MCP server (gitdiagram.com/mcp) and the GitDiagram plugin for ChatGPT and Codex. GitDiagram is run by Ahmed Khaleel. By using it you agree to these terms.",
    ],
  },
  {
    heading: "Using it fairly",
    body: [
      "Use GitDiagram only for repositories you are allowed to read, and follow GitHub's terms when you do. Don't try to get around rate limits or daily limits, overload the service, break its security, or use it to harm others. We may limit or block access that does.",
      "Diagrams and videos of public repositories are public: anyone who opens the same repository sees them. Diagrams of private repositories are kept separately and can only be read again with the same GitHub token, or the same signed-in GitHub account, that made them.",
    ],
  },
  {
    heading: "AI-generated content",
    body: [
      "Diagrams, explanations and videos are written by AI models from a repository's files. They can be incomplete or wrong, so check anything important against the code itself. They are provided for understanding a codebase, not as professional advice.",
      "The repositories belong to their owners. GitDiagram's own code is open source under the MIT License on GitHub.",
    ],
  },
  {
    heading: "Paid videos",
    body: [
      "Where the site offers a paid video, the price is shown before you pay and Stripe handles the payment. If the video can't be made, the payment is refunded automatically. For anything else about a payment, email us.",
    ],
  },
  {
    heading: "No warranty",
    body: [
      "GitDiagram is provided as is and as available, without warranties of any kind. To the extent the law allows, we are not liable for indirect or consequential losses from using it, and our total liability is limited to what you paid us in the last twelve months.",
    ],
  },
  {
    heading: "Changes",
    body: [
      "We may change GitDiagram or these terms. When the terms change, the date above changes too; using GitDiagram after that means you accept the new terms.",
    ],
  },
  {
    heading: "Contact",
    body: [
      "Questions about these terms: ahmed@gitdiagram.com. See also the privacy policy at gitdiagram.com/privacy.",
    ],
  },
];

export default function TermsPage() {
  return (
    <TextPage
      title="Terms of Service"
      updated="September 29, 2026"
      sections={sections}
    />
  );
}
