import { z } from "zod";

import { markGenerationCancelled } from "~/server/generate/cancellation";
import {
  generationCancelTokenSchema,
  generationSessionIdSchema,
} from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const MAX_CANCELLATION_REQUEST_BYTES = 256;
const cancellationRequestSchema = z.strictObject({
  session_id: generationSessionIdSchema,
  cancel_token: generationCancelTokenSchema,
});

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function jsonError(error: string, status: number): Response {
  return Response.json(
    { ok: false, error },
    { status, headers: RESPONSE_HEADERS },
  );
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin cancellation is not allowed.", 403);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return jsonError("Content-Type must be application/json.", 415);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_CANCELLATION_REQUEST_BYTES
  ) {
    return jsonError("Request payload is too large.", 413);
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return jsonError("Invalid request payload.", 400);
  }

  if (
    new TextEncoder().encode(body).byteLength > MAX_CANCELLATION_REQUEST_BYTES
  ) {
    return jsonError("Request payload is too large.", 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return jsonError("Invalid request payload.", 400);
  }

  const parsed = cancellationRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError("Invalid request payload.", 400);
  }

  try {
    await markGenerationCancelled(
      parsed.data.session_id,
      parsed.data.cancel_token,
    );
  } catch {
    console.error(
      JSON.stringify({
        event: "generate.cancellation.write_failed",
        session_id: parsed.data.session_id,
        error: "Cancellation could not be recorded.",
      }),
    );
    return jsonError("Cancellation is temporarily unavailable.", 503);
  }

  return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
}
