import { z } from "zod";

import {
  COMMIT_SHA_INVALID_ERROR,
  parseCommitSha,
} from "~/features/diagram/commit";
import { classifyGitHubError } from "~/server/generate/github-errors";
import { resolveCommit } from "~/server/generate/github";
import {
  consumeGenerationInfrastructureRateLimit,
  getGenerationInfrastructureRateLimitMessage,
} from "~/server/generate/rate-limit";
import { getDiagramStateRecord } from "~/server/storage/diagram-state";
import {
  commitInputSchema,
  credentialSchema,
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { getClientIp } from "~/server/http/client-ip";
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
  commit: commitInputSchema.optional(),
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

  let commit: ReturnType<typeof parseCommitSha> = null;
  if (parsed.data.commit !== undefined) {
    commit = parseCommitSha(parsed.data.commit);
    if (!commit) {
      return jsonErrorResponse(
        COMMIT_SHA_INVALID_ERROR,
        400,
        "COMMIT_SHA_INVALID",
      );
    }
  }

  let hasCallerGithubToken = false;
  try {
    const { githubPat, githubStorageKey } = await resolveRequestCredentials(
      request,
      { githubPat: parsed.data.github_pat },
    );
    hasCallerGithubToken = Boolean(githubPat?.trim());

    if (!commit) {
      const state = await getDiagramStateRecord(
        parsed.data.username,
        parsed.data.repo,
        githubStorageKey,
      );
      return Response.json(state, { headers: NO_STORE_RESPONSE_HEADERS });
    }

    // Storage only ever holds full SHAs, so a short one is resolved first. A
    // full SHA is already the key: its diagram is immutable and is reopened
    // without asking GitHub anything.
    let fullSha = commit.sha;
    if (!commit.full) {
      // Resolving calls GitHub with the server's shared credentials; bound it
      // like the rest of the generation endpoints.
      const rateLimit = await consumeGenerationInfrastructureRateLimit({
        clientIp: getClientIp(request),
      });
      if (!rateLimit.allowed) {
        return jsonErrorResponse(
          getGenerationInfrastructureRateLimitMessage(
            rateLimit.retryAfterSeconds,
          ),
          429,
          "RATE_LIMITED",
        );
      }
      fullSha = await resolveCommit(
        parsed.data.username,
        parsed.data.repo,
        commit.sha,
        githubPat,
        request.signal,
      );
    }
    const state = await getDiagramStateRecord(
      parsed.data.username,
      parsed.data.repo,
      githubStorageKey,
      fullSha,
    );
    return Response.json(state, { headers: NO_STORE_RESPONSE_HEADERS });
  } catch (error) {
    const githubError = commit
      ? classifyGitHubError(error, hasCallerGithubToken)
      : null;
    if (githubError) {
      return jsonErrorResponse(
        githubError.message,
        githubError.status,
        githubError.errorCode,
      );
    }
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
