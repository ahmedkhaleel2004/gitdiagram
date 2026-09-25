import { isAdminRequest } from "~/server/admin/operator";
import { readAdminState } from "~/server/admin/state";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
} from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** The dashboard's polled state: switches, today's budgets and balances. */
export async function GET(request: Request): Promise<Response> {
  if (!isAdminRequest(request)) return jsonErrorResponse("Sign in first.", 401);
  return Response.json(await readAdminState(), {
    headers: NO_STORE_RESPONSE_HEADERS,
  });
}
