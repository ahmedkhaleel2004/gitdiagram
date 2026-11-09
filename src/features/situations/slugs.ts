// The situation guides' addresses (/guides/{slug}), apart from their text so
// the Worker's firewall can answer any other /guides/ path with a 404 without
// bundling the pages. content.test.ts keeps the two lists equal.
export const SITUATION_SLUGS = [
  "understand-a-new-codebase",
  "understand-a-monorepo",
  "readme-architecture-diagram",
  "private-repository-diagram",
  "legacy-codebase",
  "review-an-unfamiliar-pull-request",
  "technical-interview-codebase-prep",
  "github-repo-visualizer",
  "architecture-map-for-ai-coding-agents",
] as const;

/** A /guides/ path that is none of the pages (or their Markdown twins). */
export function isUnknownGuidePath(pathname: string): boolean {
  if (!pathname.startsWith("/guides/")) return false;
  const match = /^\/guides\/([^/]+?)(?:\.md|\/llms\.txt)?\/?$/.exec(pathname);
  return !match || !(SITUATION_SLUGS as readonly string[]).includes(match[1]!);
}
