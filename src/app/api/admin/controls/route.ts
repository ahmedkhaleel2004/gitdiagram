import { z } from "zod";

import { writeControls } from "~/server/admin/controls";
import { emitLiveEvent } from "~/server/admin/live-events";
import { isAdminRequest } from "~/server/admin/operator";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limit = (max: number) => z.number().int().min(0).max(max).nullable();

const requestSchema = z
  .strictObject({
    videoAudience: z.enum(["priority", "desktop", "everyone"]),
    videosPaused: z.boolean(),
    videoDailyLimit: limit(10_000),
    videoPersonDailyLimit: limit(1_000),
    videoNetworkDailyLimit: limit(1_000),
  })
  .partial();

/** Flip a live switch. Every server instance picks it up within a second. */
export async function POST(request: Request): Promise<Response> {
  if (!isAdminRequest(request)) return jsonErrorResponse("Sign in first.", 401);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 1024,
    crossOriginError: "Change settings from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  try {
    const controls = await writeControls(parsed.data);
    void emitLiveEvent({ kind: "control.changed", changes: parsed.data });
    return Response.json(
      { ok: true, controls },
      { headers: NO_STORE_RESPONSE_HEADERS },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "admin.controls.write_failed",
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return jsonErrorResponse("The change did not save. Try again.", 503);
  }
}
