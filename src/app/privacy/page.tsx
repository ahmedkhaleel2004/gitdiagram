import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What GitDiagram collects, why, and who it is shared with.",
  alternates: { canonical: "/privacy" },
};

const sections: { heading: string; body: string[] }[] = [
  {
    heading: "What GitDiagram reads",
    body: [
      "When you ask for a diagram or video, GitDiagram reads that repository's file tree, README and a few source files through the GitHub API. Diagrams and videos of public repositories are stored and shown to anyone who opens the same repository.",
      "For a private repository you supply your own GitHub token. The token is sent with each request and never saved on our servers; the diagram is stored in a separate private location that only that token can reach.",
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
      "Your IP address and approximate location (from our host, Vercel) are used to apply rate limits and daily limits and to decide where videos are available. A random ID cookie, kept for up to a year, counts video limits per browser. Rate-limit counters expire on their own.",
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
      "Vercel (hosting), Cloudflare (storage and live visitor counts), Upstash (rate-limit counters), PostHog (analytics), Resend (delivering feedback emails), Stripe (payments), GitHub (repository data), and the AI providers that write diagrams, videos and narration (OpenAI, Anthropic and OpenRouter). Repository content is sent to those AI providers only to make what you asked for.",
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
    <main className="container mx-auto max-w-2xl px-6 py-12 text-black dark:text-neutral-100">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Last updated September 29, 2026
      </p>
      {sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
