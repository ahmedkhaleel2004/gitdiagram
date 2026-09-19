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
    // Only mixed-case repository URLs enter this branch in production. Keep
    // query parameters (including PostHog campaign attribution) on redirects.
    if (request.method === "GET" || request.method === "HEAD") {
      const url = request.nextUrl.clone();
      const path = url.pathname;
      if (
        !/^\/(?:api|phx9a|_next)\//i.test(path) &&
        /^\/[^/]+\/[^/]+(?:\/opengraph-image)?\/?$/.test(path) &&
        path !== path.toLowerCase()
      ) {
        url.pathname = path.toLowerCase();
        return NextResponse.redirect(url, 308);
      }
    }
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
    // Case-sensitive lookahead avoids running Proxy on ordinary lowercase
    // pages, APIs, PostHog ingestion, or assets merely to normalize a URL.
    "/((?!api/|phx9a/|_next/)(?=[^/]*[A-Z]|[^/]+/[^/]*[A-Z])[^/]+/[^/]+(?:/opengraph-image)?)",
  ],
};
