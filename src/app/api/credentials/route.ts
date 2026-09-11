import { z } from "zod";

import {
  clearCredential,
  credentialKindSchema,
  getCredentialStatus,
  setCredential,
  storedCredentialSchema,
} from "~/server/http/request-credentials";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CREDENTIAL_REQUEST_BYTES = 4 * 1_024;
const credentialActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({
    action: z.literal("set"),
    credential: credentialKindSchema,
    value: storedCredentialSchema,
  }),
  z.strictObject({
    action: z.literal("clear"),
    credential: credentialKindSchema,
  }),
]);

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: credentialActionSchema,
    maxBytes: MAX_CREDENTIAL_REQUEST_BYTES,
    crossOriginError: "Cross-origin credential access is not allowed.",
  });
  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const status =
      parsed.data.action === "status"
        ? await getCredentialStatus()
        : parsed.data.action === "set"
          ? await setCredential(parsed.data.credential, parsed.data.value)
          : await clearCredential(parsed.data.credential);

    return Response.json(
      { ok: true, credentials: status },
      { headers: NO_STORE_RESPONSE_HEADERS },
    );
  } catch {
    console.error(
      JSON.stringify({
        event: "credentials.update_failed",
        action: parsed.data.action,
        error: "Credential settings are temporarily unavailable.",
      }),
    );
    return jsonErrorResponse(
      "Credential settings are temporarily unavailable.",
      503,
    );
  }
}
