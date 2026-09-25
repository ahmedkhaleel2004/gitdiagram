import { z } from "zod";

import { emitLiveEvent } from "~/server/admin/live-events";
import { isAdminRequest } from "~/server/admin/operator";
import { resetUsageToday } from "~/server/explainer/limits";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.strictObject({ target: z.enum(["videos", "renders"]) });

/** Start today's video or MP4 counts over, for everyone. */
export async function POST(request: Request): Promise<Response> {
  if (!isAdminRequest(request)) return jsonErrorResponse("Sign in first.", 401);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 256,
    crossOriginError: "Reset limits from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  const { target } = parsed.data;
  try {
    const cleared = await resetUsageToday(
      target === "videos" ? "generate" : "render",
    );
    void emitLiveEvent({ kind: "limits.reset", target, cleared });
    return Response.json(
      { ok: true, cleared },
      { headers: NO_STORE_RESPONSE_HEADERS },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "admin.reset_failed",
        target,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return jsonErrorResponse("The reset did not go through. Try again.", 503);
  }
}
