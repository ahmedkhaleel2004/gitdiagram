import { type NextRequest, NextResponse } from "next/server";

const REJECTION_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * GitDiagram does not expose Server Actions. Reject forged action requests at
 * the proxy boundary so they never reach the Next.js action decoder.
 */
export function proxy(request: NextRequest): NextResponse {
  if (!request.headers.has("next-action")) {
    return NextResponse.next();
  }

  return new NextResponse(null, {
    status: 404,
    headers: REJECTION_HEADERS,
  });
}

export const config = {
  matcher: [
    {
      source: "/:path*",
      has: [{ type: "header", key: "next-action" }],
    },
  ],
};
