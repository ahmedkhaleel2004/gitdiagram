import type { VisibilityReport } from "~/features/admin/visibility";
import { verifyAdminRequest } from "~/server/admin/operator";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
} from "~/server/http/same-origin-json";
import { errorText, logEvent } from "~/server/log";
import { readAgentFetches } from "~/server/visibility/agent-fetch";
import { getAiVisibility } from "~/server/visibility/ai-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const TREND_DAYS = 30;
const AGENT_DAYS = 14;

/** The dashboard's "Search & AI" panel: the daily AI answers and crawler counts. */
export async function GET(request: Request): Promise<Response> {
  if (!(await verifyAdminRequest(request)))
    return jsonErrorResponse("Sign in first.", 401);
  const [ai, agents] = await Promise.all([
    getAiVisibility(TREND_DAYS).catch((error: unknown) => {
      logEvent("warn", "admin.visibility.ai_unreadable", {
        error: errorText(error),
      });
      return null;
    }),
    readAgentFetches(AGENT_DAYS).catch((error: unknown) => {
      logEvent("warn", "admin.visibility.agents_unreadable", {
        error: errorText(error),
      });
      return null;
    }),
  ]);
  if (!ai && !agents)
    return jsonErrorResponse("Redis could not be read. Try again.", 503);
  const report: VisibilityReport = {
    summaries: ai?.summaries ?? [],
    latest: ai?.latest ?? null,
    agents,
  };
  return Response.json(report, { headers: NO_STORE_RESPONSE_HEADERS });
}
