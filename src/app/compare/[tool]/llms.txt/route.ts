import {
  COMPARE_PAGES,
  comparePage,
  comparePath,
} from "~/features/compare/content";
import { comparePageMarkdown } from "~/features/compare/markdown";
import { SITE_URL } from "~/lib/site";

// A comparison page as Markdown. The proxy rewrites /compare/{slug}.md and
// `Accept: text/markdown` requests for the page here, as for a repository.

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return COMPARE_PAGES.map((page) => ({ tool: page.slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tool: string }> },
) {
  const page = comparePage((await params).tool);
  if (!page) return new Response("Not found", { status: 404 });
  return new Response(`${comparePageMarkdown(page)}\n`, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The HTML page is the one to index; this is its plain-text twin.
      Link: `<${SITE_URL}${comparePath(page.slug)}>; rel="canonical"`,
      Vary: "Accept",
    },
  });
}
