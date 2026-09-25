import { z } from "zod";

import { setClaudeCredit } from "~/server/admin/claude-credit";
import { verifyAdminRequest } from "~/server/admin/operator";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.strictObject({
  usd: z.number().finite().min(0).max(1_000_000),
});

/** Record the Claude credit balance the Console shows right now. */
export async function POST(request: Request): Promise<Response> {
  if (!(await verifyAdminRequest(request)))
    return jsonErrorResponse("Sign in first.", 401);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 256,
    crossOriginError: "Set the balance from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  try {
    // The new credit goes back with the answer, so the dashboard shows it
    // without waiting for its next read.
    const credit = await setClaudeCredit(parsed.data.usd);
    return Response.json(
      { ok: true, credit },
      { headers: NO_STORE_RESPONSE_HEADERS },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "admin.claude_credit_failed",
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return jsonErrorResponse("The balance was not saved. Try again.", 503);
  }
}
