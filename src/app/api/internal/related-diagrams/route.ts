import { rebuildRelatedDiagrams } from "~/server/storage/related-diagrams";

// Daily cron (wrangler.jsonc): rebuilds the "More {language} diagrams" shards
// from the browse index. Runs where the visitor is, like every internal route.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return Response.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await rebuildRelatedDiagrams();
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "related.rebuild_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return Response.json(
      { ok: false, error: "Related diagrams rebuild failed." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
