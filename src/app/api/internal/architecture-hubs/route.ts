import { revalidateTag } from "next/cache";
import { rebuildArchitectureHubs } from "~/server/storage/architecture-hubs";
import { ARCHITECTURE_HUBS_TAG } from "~/server/storage/architecture-hubs-read";

// Daily cron (wrangler.jsonc): rebuilds the /architecture-examples hubs from
// the browse index, reading the stored diagrams that are new or were made
// again (within a time budget; the rest waits a day). Runs where the visitor
// is, like every internal route.
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
    const result = await rebuildArchitectureHubs();
    revalidateTag(ARCHITECTURE_HUBS_TAG, "max");
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "hubs.rebuild_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return Response.json(
      { ok: false, error: "Architecture hubs rebuild failed." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
