import { z } from "zod";

import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  isOperatorConfigured,
  isOperatorToken,
  revokeAdminSessions,
  verifyAdminRequest,
} from "~/server/admin/operator";
import { checkSignIn } from "~/server/admin/sign-in-guard";
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
export async function GET(request: Request): Promise<Response> {
  return Response.json(
    { ok: true, admin: await verifyAdminRequest(request) },
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
  if (!isOperatorConfigured()) {
    // A VIDEO_ADMIN_TOKEN under 32 characters turns the dashboard off rather
    // than accept a guessable token; say so instead of "not right".
    console.warn(
      JSON.stringify({
        event: "admin.not_configured",
        reason: process.env.VIDEO_ADMIN_TOKEN?.trim()
          ? "token_too_short"
          : "token_missing",
      }),
    );
    return jsonErrorResponse(
      "The dashboard is not set up. VIDEO_ADMIN_TOKEN needs at least 32 characters.",
      503,
    );
  }
  const correct = isOperatorToken(parsed.data.token);
  const check = await checkSignIn(request, correct);
  if (check.blocked) {
    const minutes = Math.max(1, Math.ceil(check.retryAfterSeconds / 60));
    const response = jsonErrorResponse(
      `Too many tries. Wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
      429,
    );
    response.headers.set("Retry-After", String(check.retryAfterSeconds));
    return response;
  }
  if (!correct) {
    if (check.announce)
      void emitLiveEvent({
        kind: "admin.sign_in_failed",
        ...requestOrigin(request),
      });
    // Slow down guessing; the token is far too long to guess anyway.
    await new Promise((resolve) => setTimeout(resolve, 750));
    return jsonErrorResponse("That token is not right.", 401);
  }
  const session = await createAdminSession();
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

/**
 * Sign out. With ?everywhere=1, every browser signed in to /admin is signed
 * out too (needs a valid session, and Redis).
 */
export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request))
    return jsonErrorResponse("Sign out from GitDiagram.", 403);
  if (new URL(request.url).searchParams.get("everywhere") === "1") {
    if (!(await verifyAdminRequest(request)))
      return jsonErrorResponse("Sign in first.", 401);
    try {
      await revokeAdminSessions();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "admin.sign_out_everywhere_failed",
          error:
            error instanceof Error ? error.message.slice(0, 200) : "unknown",
        }),
      );
      return jsonErrorResponse(
        "Could not sign out everywhere. Try again.",
        503,
      );
    }
    void emitLiveEvent({
      kind: "admin.signed_out_everywhere",
      ...requestOrigin(request),
    });
  }
  return Response.json(
    { ok: true },
    { headers: { ...NO_STORE_RESPONSE_HEADERS, "Set-Cookie": cookie("", 0) } },
  );
}
