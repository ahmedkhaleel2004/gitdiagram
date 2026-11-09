import { hubMarkdown } from "~/features/architecture-hubs/content";
import { hubPath } from "~/features/architecture-hubs/hubs";
import { SITE_URL } from "~/lib/site";
import { loadArchitectureHub } from "~/server/storage/architecture-hubs-read";

// A hub's first page as Markdown. The proxy rewrites
// /architecture-examples/{hub}.md and `Accept: text/markdown` requests for the
// page here, as for a repository.

export const revalidate = 21600;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hub: string }> },
) {
  const { hub: slug } = await params;
  const loaded = await loadArchitectureHub(slug, 1);
  if (!loaded) return new Response("Not found", { status: 404 });
  return new Response(`${hubMarkdown(loaded.hub, loaded.page)}\n`, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${SITE_URL}${hubPath(slug)}>; rel="canonical"`,
      Vary: "Accept",
    },
  });
}
