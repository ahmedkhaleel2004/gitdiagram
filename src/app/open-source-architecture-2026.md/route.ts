import { reportMarkdown } from "~/features/architecture-report/content";

// The architecture report as Markdown, for agents and anyone who quotes it.
export const dynamic = "force-static";

export function GET() {
  return new Response(reportMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
