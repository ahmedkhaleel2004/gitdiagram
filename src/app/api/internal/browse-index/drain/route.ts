import { drainPendingBrowseIndex } from "~/server/storage/browse-diagrams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return Response.json(
      { ok: false, error: "Unauthorized." },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  try {
    const entryCount = await drainPendingBrowseIndex();
    return Response.json(
      { ok: true, entry_count: entryCount },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "browse.index.cron_drain_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return Response.json(
      { ok: false, error: "Browse index drain failed." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
