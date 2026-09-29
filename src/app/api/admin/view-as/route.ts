import { z } from "zod";

import { verifyAdminRequest } from "~/server/admin/operator";
import {
  clearViewAsCookie,
  viewAsCookie,
  viewAsCountry,
} from "~/server/admin/view-as";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.strictObject({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
});

/** The country this browser previews video pages from, if any. */
export async function GET(request: Request): Promise<Response> {
  if (!(await verifyAdminRequest(request)))
    return jsonErrorResponse("Sign in first.", 401);
  return Response.json(
    { ok: true, country: viewAsCountry(request) },
    { headers: NO_STORE_RESPONSE_HEADERS },
  );
}

/** Place this browser in a country (see view-as.ts), or take it back home. */
export async function POST(request: Request): Promise<Response> {
  if (!(await verifyAdminRequest(request)))
    return jsonErrorResponse("Sign in first.", 401);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 256,
    crossOriginError: "Change settings from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  const { country } = parsed.data;
  const cookie = country ? viewAsCookie(country) : clearViewAsCookie();
  if (!cookie) return jsonErrorResponse("The operator token is not set.", 503);
  const response = Response.json(
    { ok: true, country },
    { headers: NO_STORE_RESPONSE_HEADERS },
  );
  response.headers.append("Set-Cookie", cookie);
  return response;
}
