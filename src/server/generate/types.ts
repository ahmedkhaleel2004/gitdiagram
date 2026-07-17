import { z } from "zod";
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
  .regex(/^[A-Za-z0-9._-]+$/u);
export const credentialSchema = z.string().trim().min(1).max(2_048);

export const generationSessionIdSchema = z.uuid();
export const generationCancelTokenSchema = z.uuid();

const generateRequestSchema = z
  .strictObject({
    username: githubUsernameSchema,
    repo: githubRepoSchema,
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

type GenerateRequest = z.infer<typeof generateRequestSchema>;

export type GenerateRequestParseResult =
  | { success: true; data: GenerateRequest }
  | {
      success: false;
      status: 400 | 413 | 415;
      error: string;
      errorCode: "VALIDATION_ERROR" | "PAYLOAD_TOO_LARGE";
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

  return { success: true, data: parsed.data };
}

export function sseMessage(payload: DiagramStreamMessage): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
