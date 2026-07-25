import { NextResponse } from "next/server";

import { checkReadiness } from "~/server/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await checkReadiness();
  return NextResponse.json(
    {
      ok: readiness.ok,
      status: readiness.ok ? "ok" : "unavailable",
      checks: readiness.checks,
    },
    {
      status: readiness.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
