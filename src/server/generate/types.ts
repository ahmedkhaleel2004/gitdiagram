import { z } from "zod";
import {
  COMMIT_SHA_INVALID_ERROR,
  MAX_COMMIT_INPUT_LENGTH,
  parseCommitSha,
} from "~/features/diagram/commit";
import type { DiagramStreamMessage } from "~/features/diagram/types";

export const MAX_GENERATION_REQUEST_BYTES = 16 * 1024;

export const githubUsernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u);
export const githubRepoSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/u)
  // "." and ".." are legal under the character rule but resolve away when
  // interpolated into a GitHub API path, retargeting the request.
  .refine((value) => value !== "." && value !== "..");
export const credentialSchema = z.string().trim().min(1).max(2_048);
/**
 * A commit SHA as the visitor gave it. Its format is checked separately (see
 * `parseCommitSha`) so a malformed SHA gets its own error, not a generic one.
 */
export const commitInputSchema = z.string().max(MAX_COMMIT_INPUT_LENGTH);

export const generationSessionIdSchema = z.uuid();
export const generationCancelTokenSchema = z.uuid();

const generateRequestSchema = z
  .strictObject({
    username: githubUsernameSchema,
    repo: githubRepoSchema,
    commit: commitInputSchema.optional(),
    api_key: credentialSchema.optional(),
    github_pat: credentialSchema.optional(),
    session_id: generationSessionIdSchema.optional(),
    cancel_token: generationCancelTokenSchema.optional(),
  })
  .refine(
    ({ cancel_token: cancelToken, session_id: sessionId }) =>
      Boolean(cancelToken) === Boolean(sessionId),
    { message: "session_id and cancel_token must be provided together." },
  );

type GenerateRequest = Omit<z.infer<typeof generateRequestSchema>, "commit"> & {
  /** Lowercase, 7 to 40 hexadecimal characters; absent for the default branch. */
  commit?: string;
};

export type GenerateRequestParseResult =
  | { success: true; data: GenerateRequest }
  | {
      success: false;
      status: 400 | 413 | 415;
      error: string;
      errorCode:
        "VALIDATION_ERROR" | "PAYLOAD_TOO_LARGE" | "COMMIT_SHA_INVALID";
    };

export async function parseGenerateRequest(
  request: Request,
): Promise<GenerateRequestParseResult> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return {
      success: false,
      status: 415,
      error: "Content-Type must be application/json.",
      errorCode: "VALIDATION_ERROR",
    };
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_GENERATION_REQUEST_BYTES
  ) {
    return {
      success: false,
      status: 413,
      error: "Request payload is too large.",
      errorCode: "PAYLOAD_TOO_LARGE",
    };
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return {
      success: false,
      status: 400,
      error: "Invalid request payload.",
      errorCode: "VALIDATION_ERROR",
    };
  }

  if (
    new TextEncoder().encode(body).byteLength > MAX_GENERATION_REQUEST_BYTES
  ) {
    return {
      success: false,
      status: 413,
      error: "Request payload is too large.",
      errorCode: "PAYLOAD_TOO_LARGE",
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return {
      success: false,
      status: 400,
      error: "Invalid request payload.",
      errorCode: "VALIDATION_ERROR",
    };
  }

  const parsed = generateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      status: 400,
      error: "Invalid request payload.",
      errorCode: "VALIDATION_ERROR",
    };
  }

  const { commit: commitInput, ...fields } = parsed.data;
  if (commitInput === undefined) return { success: true, data: fields };

  const commit = parseCommitSha(commitInput);
  if (!commit) {
    return {
      success: false,
      status: 400,
      error: COMMIT_SHA_INVALID_ERROR,
      errorCode: "COMMIT_SHA_INVALID",
    };
  }
  return { success: true, data: { ...fields, commit: commit.sha } };
}

export function sseMessage(payload: DiagramStreamMessage): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
