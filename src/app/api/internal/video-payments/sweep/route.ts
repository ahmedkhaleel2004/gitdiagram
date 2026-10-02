import {
  isVideoSaleConfigured,
  sweepVideoPayments,
} from "~/server/explainer/payments";
import { reapOrphanedRuns } from "~/server/explainer/run-journal";
import { readVideoArtifact } from "~/server/explainer/store";
import { errorText, logEvent } from "~/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Refunds paid videos that were never made (see sweepVideoPayments), and
 * settles runs that died without cleaning up (run-journal.ts). A cron calls
 * it every 15 minutes with CRON_SECRET.
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
  // Runs and renders whose server was killed: give back what they reserved.
  const lost = await reapOrphanedRuns();
  if (!isVideoSaleConfigured())
    return Response.json(
      { ok: true, skipped: true, lost },
      { headers: NO_STORE },
    );
  try {
    const result = await sweepVideoPayments(async (owner, repo, since) => {
      const video = await readVideoArtifact(owner, repo);
      return video !== null && Date.parse(video.createdAt) >= since;
    });
    if (result.refunded) logEvent("info", "video.payment.sweep", { ...result });
    return Response.json({ ok: true, ...result, lost }, { headers: NO_STORE });
  } catch (error) {
    logEvent("error", "video.payment.sweep_failed", {
      error: errorText(error),
    });
    return Response.json(
      { ok: false, error: "Payment sweep failed." },
      { status: 503, headers: NO_STORE },
    );
  }
}
