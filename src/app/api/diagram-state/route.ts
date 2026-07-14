import { z } from "zod";

import { getDiagramStateRecord } from "~/server/storage/diagram-state";
import {
  credentialSchema,
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { isSameOriginRequest } from "~/server/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_DIAGRAM_STATE_REQUEST_BYTES = 4 * 1024;
const diagramStateRequestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  github_pat: credentialSchema.optional(),
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

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin state access is not allowed.", 403);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return jsonError("Content-Type must be application/json.", 415);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_DIAGRAM_STATE_REQUEST_BYTES
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
    new TextEncoder().encode(body).byteLength > MAX_DIAGRAM_STATE_REQUEST_BYTES
  ) {
    return jsonError("Request payload is too large.", 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return jsonError("Invalid request payload.", 400);
  }

  const parsed = diagramStateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError("Invalid request payload.", 400);
  }

  try {
    const state = await getDiagramStateRecord(
      parsed.data.username,
      parsed.data.repo,
      parsed.data.github_pat,
    );
    return Response.json(state, { headers: RESPONSE_HEADERS });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagram_state.read_failed",
        visibility: parsed.data.github_pat ? "private" : "public",
        error: "Diagram state is temporarily unavailable.",
      }),
    );
    return jsonError("Diagram state is temporarily unavailable.", 503);
  }
}
