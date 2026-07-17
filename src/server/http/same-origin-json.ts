import type { ZodType } from "zod";

import { isSameOriginRequest } from "~/server/http/same-origin";

export const NO_STORE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const DEFAULT_MESSAGES = {
  invalidContentType: "Content-Type must be application/json.",
  invalidPayload: "Invalid request payload.",
  payloadTooLarge: "Request payload is too large.",
} as const;

type SameOriginJsonRequestOptions<T> = {
  schema: ZodType<T>;
  maxBytes: number;
  crossOriginError: string;
};

export type SameOriginJsonRequestResult<T> =
  { success: true; data: T } | { success: false; response: Response };

export function jsonErrorResponse(error: string, status: number): Response {
  return Response.json(
    { ok: false, error },
    { status, headers: NO_STORE_RESPONSE_HEADERS },
  );
}

function isApplicationJson(contentType: string | null): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

export async function parseSameOriginJsonRequest<T>(
  request: Request,
  options: SameOriginJsonRequestOptions<T>,
): Promise<SameOriginJsonRequestResult<T>> {
  if (!isSameOriginRequest(request)) {
    return {
      success: false,
      response: jsonErrorResponse(options.crossOriginError, 403),
    };
  }

  if (!isApplicationJson(request.headers.get("content-type"))) {
    return {
      success: false,
      response: jsonErrorResponse(DEFAULT_MESSAGES.invalidContentType, 415),
    };
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    return {
      success: false,
      response: jsonErrorResponse(DEFAULT_MESSAGES.payloadTooLarge, 413),
    };
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return {
      success: false,
      response: jsonErrorResponse(DEFAULT_MESSAGES.invalidPayload, 400),
    };
  }

  if (new TextEncoder().encode(body).byteLength > options.maxBytes) {
    return {
      success: false,
      response: jsonErrorResponse(DEFAULT_MESSAGES.payloadTooLarge, 413),
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return {
      success: false,
      response: jsonErrorResponse(DEFAULT_MESSAGES.invalidPayload, 400),
    };
  }

  const parsed = options.schema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      response: jsonErrorResponse(DEFAULT_MESSAGES.invalidPayload, 400),
    };
  }

  return { success: true, data: parsed.data };
}
