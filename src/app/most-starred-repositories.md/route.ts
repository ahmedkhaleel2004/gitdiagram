import { popularMarkdown } from "~/features/popular-repos/content";

// The list as Markdown, for agents (single-segment path on purpose: a
// two-segment one would collide with the repository Markdown rewrite).
export const dynamic = "force-static";

export function GET() {
  return new Response(popularMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
