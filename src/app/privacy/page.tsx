import type { Metadata } from "next";

import { TextPage, type TextPageSection } from "~/components/text-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What GitDiagram collects, why, and who it is shared with.",
  alternates: { canonical: "/privacy" },
};

const sections: TextPageSection[] = [
  {
    heading: "What GitDiagram reads",
    body: [
      "When you ask for a diagram or video, GitDiagram reads that repository's file tree, README and a few source files through the GitHub API. Diagrams and videos of public repositories are stored and shown to anyone who opens the same repository.",
      "For a private repository you supply your own GitHub token. The token is sent with each request and never saved on our servers; the diagram is stored in a separate private location that only that token can reach.",
    ],
  },
  {
    heading: "AI assistants (ChatGPT, Codex, Claude and other MCP apps)",
    body: [
      "When an AI assistant uses GitDiagram through its MCP server (gitdiagram.com/mcp) or the GitDiagram plugin, GitDiagram receives only what the assistant sends to its tools: a repository name or GitHub link, or a search term. It needs no account or sign-in, never receives your chat, and only returns diagrams, explanations and videos of public repositories that are already stored. In ChatGPT, the diagram is shown in an interactive view that opens links only on github.com and gitdiagram.com.",
      "To apply rate limits, GitDiagram uses the caller's IP address and, when ChatGPT sends one, its anonymized user ID, which is hashed before use. Those rate-limit counters expire within an hour. We keep daily totals of tool calls per tool and per assistant app (such as chatgpt or codex) for 120 days, without IP addresses or user IDs. Our live dashboard briefly shows each call's tool, the public repository it was about and an approximate location derived from the IP address; these notices are held for at most a day and never written to a database.",
    ],
  },
  {
    heading: "Keys you enter",
    body: [
      "GitHub tokens and OpenAI keys you enter are kept in a secure, HttpOnly cookie in your browser for up to 30 days and sent with your requests. They are never saved on our servers, and you can remove them at any time from the same settings.",
    ],
  },
  {
    heading: "Analytics",
    body: [
      "We use PostHog to understand how the site is used: page views, clicks, errors and session replays. Replays mask everything typed into inputs and do not record network requests. We don't create profiles of anonymous visitors.",
    ],
  },
  {
    heading: "Abuse control and cookies",
    body: [
      "Your IP address and approximate location (from our host, Cloudflare) are used to apply rate limits and daily limits and to decide where videos are available. A random ID cookie, kept for up to a year, counts video limits per browser. Rate-limit counters expire on their own.",
    ],
  },
  {
    heading: "Payments",
    body: [
      "If you buy a video, Stripe handles the payment. Your card details go to Stripe, never to us. We keep the Stripe payment's ID, the repository it was for and your browser's random ID, to make that one video and to refund it automatically if it can't be made.",
    ],
  },
  {
    heading: "Who processes data",
    body: [
      "Cloudflare (hosting, storage and live visitor counts), Upstash (rate-limit counters), PostHog (analytics), Resend (delivering feedback emails), Stripe (payments), GitHub (repository data), and the AI providers that write diagrams, videos and narration (OpenAI, Anthropic and OpenRouter). Repository content is sent to those AI providers only to make what you asked for.",
    ],
  },
  {
    heading: "How long we keep data",
    body: [
      "Diagrams and videos of public repositories stay published until they are replaced or removed; private diagrams can only be read with the token that made them. Keys you enter stay in your browser for up to 30 days; the random video ID cookie, up to a year. Rate-limit counters expire at the end of their window, at most a day. Payment records are kept as long as tax and accounting rules require. Analytics events and session replays are kept under our PostHog plan's retention. Emails are kept while we need them to help you. You can ask us to delete anything about you at any time.",
    ],
  },
  {
    heading: "Email",
    body: [
      "If you email us or send feedback, we keep that conversation to reply to you. We don't sell personal data or use it for advertising. Sponsors see only aggregate numbers, such as clicks on their placement.",
    ],
  },
  {
    heading: "Contact",
    body: ["Questions or deletion requests: ahmed@gitdiagram.com."],
  },
];

export default function PrivacyPage() {
  return (
    <TextPage
      title="Privacy Policy"
      updated="October 8, 2026"
      sections={sections}
    />
  );
}
