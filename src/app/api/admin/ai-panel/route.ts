import { verifyAdminRequest } from "~/server/admin/operator";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
} from "~/server/http/same-origin-json";
import { errorText, logEvent } from "~/server/log";
import { getPanelView } from "~/server/visibility/ai-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** The dashboard's "Prompt gaps" panel: the weekly prompt panel's report. */
export async function GET(request: Request): Promise<Response> {
  if (!(await verifyAdminRequest(request)))
    return jsonErrorResponse("Sign in first.", 401);
  try {
    return Response.json(await getPanelView(), {
      headers: NO_STORE_RESPONSE_HEADERS,
    });
  } catch (error) {
    logEvent("warn", "admin.ai_panel.unreadable", { error: errorText(error) });
    return jsonErrorResponse("Redis could not be read. Try again.", 503);
  }
}
