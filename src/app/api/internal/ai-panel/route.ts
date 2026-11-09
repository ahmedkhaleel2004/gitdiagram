import { errorText, logEvent } from "~/server/log";
import { runPanelStep } from "~/server/visibility/ai-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };
// Questions stop starting well before the function's limit, so every answer
// is stored.
const RUN_MS = 240_000;

/**
 * One step of the weekly prompt panel (see ai-panel.ts). The Monday cron
 * calls it every 10 minutes with CRON_SECRET; each call answers what is still
 * open and does nothing once the week is done. `?restart=1` starts the week
 * over.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  )
    return Response.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers: NO_STORE },
    );
  try {
    const result = await runPanelStep({
      deadline: Date.now() + RUN_MS,
      restart: new URL(request.url).searchParams.get("restart") === "1",
    });
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    logEvent("error", "ai_panel.step_failed", { error: errorText(error) });
    return Response.json(
      { ok: false, error: "The prompt panel step failed." },
      { status: 503, headers: NO_STORE },
    );
  }
}
