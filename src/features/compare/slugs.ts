// The comparison pages' addresses (/compare/{slug}), apart from their text so
// the Worker's firewall can answer any other /compare/ path with a 404
// without bundling the pages. content.test.ts keeps the two lists equal.
export const COMPARE_SLUGS = [
  "deepwiki",
  "sourcegraph",
  "mermaid",
  "dependency-cruiser",
  "madge",
  "structurizr",
] as const;

/** A /compare/ path that is none of the pages (or their Markdown twins). */
export function isUnknownComparePath(pathname: string): boolean {
  if (!pathname.startsWith("/compare/")) return false;
  const match = /^\/compare\/([^/]+?)(?:\.md|\/llms\.txt)?\/?$/.exec(pathname);
  return !match || !(COMPARE_SLUGS as readonly string[]).includes(match[1]!);
}
