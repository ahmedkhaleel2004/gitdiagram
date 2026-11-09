import { hubsIndexMarkdown } from "~/features/architecture-hubs/content";
import { HUBS_PATH } from "~/features/architecture-hubs/hubs";
import { SITE_URL } from "~/lib/site";
import { readArchitectureHubs } from "~/server/storage/architecture-hubs-read";

// Every architecture hub as a Markdown list, for agents.
export const dynamic = "force-dynamic";

export async function GET() {
  const index = await readArchitectureHubs();
  if (!index) return new Response("Not found", { status: 404 });
  return new Response(`${hubsIndexMarkdown(index)}\n`, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
      Link: `<${SITE_URL}${HUBS_PATH}>; rel="canonical"`,
    },
  });
}
