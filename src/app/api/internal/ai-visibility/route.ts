import { errorText, logEvent } from "~/server/log";
import { runAiVisibility } from "~/server/visibility/ai-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };
// Questions stop starting well before the function's limit, so the answers
// are always stored.
const RUN_MS = 240_000;

/**
 * Asks ChatGPT's and Claude's models the day's questions and records how
 * often they name GitDiagram (see ai-visibility.ts). Vercel Cron calls it
 * once a day with CRON_SECRET; `?force=1` runs again on a day that already ran.
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
    const summary = await runAiVisibility({
      deadline: Date.now() + RUN_MS,
      force: new URL(request.url).searchParams.get("force") === "1",
    });
    return Response.json(
      summary ? { ok: true, summary } : { ok: true, skipped: "already ran" },
      { headers: NO_STORE },
    );
  } catch (error) {
    logEvent("error", "ai_visibility.run_failed", {
      error: errorText(error),
    });
    return Response.json(
      { ok: false, error: "The AI visibility run failed." },
      { status: 503, headers: NO_STORE },
    );
  }
}
