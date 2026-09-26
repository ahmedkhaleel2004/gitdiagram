import {
  drainParkedEvents,
  isPresenceWorker,
} from "~/server/admin/live-events";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
} from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the presence worker (never a browser) when a dashboard connects
 * and every minute while one is open: marks the feed watched, and hands over
 * the events parked while nobody was (see live-events.ts).
 */
export async function POST(request: Request): Promise<Response> {
  if (!isPresenceWorker(request)) return jsonErrorResponse("Forbidden.", 403);
  try {
    const events = await drainParkedEvents();
    return Response.json({ events }, { headers: NO_STORE_RESPONSE_HEADERS });
  } catch {
    return jsonErrorResponse("The parked events could not be read.", 503);
  }
}
