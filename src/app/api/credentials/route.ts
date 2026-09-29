import { z } from "zod";

import { readGitHubConnectConfig } from "~/server/github-connect/config";
import { revokeUserToken } from "~/server/github-connect/oauth";
import {
  clearableCredentialSchema,
  clearCredential,
  credentialKindSchema,
  getCredentialStatus,
  readGitHubConnectionToken,
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
    credential: clearableCredentialSchema,
  }),
]);

async function disconnectGitHub() {
  const token = await readGitHubConnectionToken();
  const status = await clearCredential("github_app");
  const config = readGitHubConnectConfig();
  if (token && config) await revokeUserToken(config, token);
  return status;
}

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
    const action = parsed.data;
    const status =
      action.action === "status"
        ? await getCredentialStatus()
        : action.action === "set"
          ? await setCredential(action.credential, action.value)
          : action.credential === "github_app"
            ? await disconnectGitHub()
            : await clearCredential(action.credential);

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
