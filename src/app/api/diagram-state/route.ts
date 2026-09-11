import { z } from "zod";

import { getDiagramStateRecord } from "~/server/storage/diagram-state";
import {
  credentialSchema,
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import {
  jsonErrorResponse,
  NO_STORE_RESPONSE_HEADERS,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";
import { resolveRequestCredentials } from "~/server/http/request-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_DIAGRAM_STATE_REQUEST_BYTES = 4 * 1024;
const diagramStateRequestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  github_pat: credentialSchema.optional(),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: diagramStateRequestSchema,
    maxBytes: MAX_DIAGRAM_STATE_REQUEST_BYTES,
    crossOriginError: "Cross-origin state access is not allowed.",
  });
  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const { githubPat } = await resolveRequestCredentials(request, {
      githubPat: parsed.data.github_pat,
    });
    const state = await getDiagramStateRecord(
      parsed.data.username,
      parsed.data.repo,
      githubPat,
    );
    return Response.json(state, { headers: NO_STORE_RESPONSE_HEADERS });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagram_state.read_failed",
        visibility: "unknown",
        error: "Diagram state is temporarily unavailable.",
      }),
    );
    return jsonErrorResponse("Diagram state is temporarily unavailable.", 503);
  }
}
