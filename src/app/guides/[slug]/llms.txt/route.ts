import {
  SITUATION_PAGES,
  situationPage,
  situationPath,
} from "~/features/situations/content";
import { situationMarkdown } from "~/features/situations/markdown";
import { SITE_URL } from "~/lib/site";

// A situation guide as Markdown. The proxy rewrites /guides/{slug}.md and
// `Accept: text/markdown` requests for the page here, as for a repository.

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return SITUATION_PAGES.map((page) => ({ slug: page.slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const page = situationPage((await params).slug);
  if (!page) return new Response("Not found", { status: 404 });
  return new Response(`${situationMarkdown(page)}\n`, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The HTML page is the one to index; this is its plain-text twin.
      Link: `<${SITE_URL}${situationPath(page.slug)}>; rel="canonical"`,
      Vary: "Accept",
    },
  });
}
