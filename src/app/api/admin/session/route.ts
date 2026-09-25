import { z } from "zod";

import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  isAdminRequest,
  isOperatorToken,
} from "~/server/admin/operator";
import { isSameOriginRequest } from "~/server/http/same-origin";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.strictObject({ token: z.string().min(1).max(512) });

function cookie(value: string, maxAgeSeconds: number): string {
  return [
    `${ADMIN_SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Whether this browser is signed in to /admin. Only browsers that turned on
 * operator tools ask, so a visitor's page never calls this.
 */
export function GET(request: Request): Response {
  return Response.json(
    { ok: true, admin: isAdminRequest(request) },
    { headers: NO_STORE_RESPONSE_HEADERS },
  );
}

/** Sign in to /admin with the operator token. */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 1024,
    crossOriginError: "Sign in from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  if (!isOperatorToken(parsed.data.token)) {
    void emitLiveEvent({
      kind: "admin.sign_in_failed",
      ...requestOrigin(request),
    });
    // Slow down guessing; the token is far too long to guess anyway.
    await new Promise((resolve) => setTimeout(resolve, 750));
    return jsonErrorResponse("That token is not right.", 401);
  }
  const session = createAdminSession();
  if (!session) return jsonErrorResponse("The dashboard is not set up.", 503);
  void emitLiveEvent({ kind: "admin.signed_in", ...requestOrigin(request) });
  return Response.json(
    { ok: true },
    {
      headers: {
        ...NO_STORE_RESPONSE_HEADERS,
        "Set-Cookie": cookie(session.value, session.maxAgeSeconds),
      },
    },
  );
}

/** Sign out. */
export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request))
    return jsonErrorResponse("Sign out from GitDiagram.", 403);
  return Response.json(
    { ok: true },
    { headers: { ...NO_STORE_RESPONSE_HEADERS, "Set-Cookie": cookie("", 0) } },
  );
}
