import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";
import { proxyDecision } from "~/lib/proxy-rules";
import { recordAgentFetch } from "~/server/visibility/agent-fetch";

const REJECTION_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * GitDiagram does not expose Server Actions. Reject forged action requests at
 * the proxy boundary so they never reach the Next.js action decoder.
 */
export function proxy(
  request: NextRequest,
  event?: NextFetchEvent,
): NextResponse {
  // The rules themselves live in ~/lib/proxy-rules: on Cloudflare the Worker
  // entry applies them without this file (see cloudflare/worker.ts).
  const { decision, surface } = proxyDecision(
    request.method,
    request.nextUrl.pathname,
    request.headers,
  );
  if (decision.action === "reject")
    return new NextResponse(null, {
      status: 404,
      headers: REJECTION_HEADERS,
    });
  // Best effort, after the response: one Redis pipeline for known bots.
  if (surface !== null) {
    const counted = recordAgentFetch(
      request.headers.get("user-agent"),
      surface,
    );
    event?.waitUntil(counted);
  }
  if (decision.action === "next") return NextResponse.next();
  // Keep query parameters (including PostHog campaign attribution).
  const url = request.nextUrl.clone();
  url.pathname = decision.pathname;
  return decision.action === "redirect"
    ? NextResponse.redirect(url, 308)
    : NextResponse.rewrite(url);
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
    // A repository page's Markdown twin (see markdownRoute).
    "/((?!api/|phx9a/|_next/)[^/]+/[^/]+\\.md)",
    {
      source: "/((?!api/|phx9a/|_next/)[^/]+/[^/]+)",
      has: [{ type: "header", key: "accept", value: ".*text/markdown.*" }],
    },
    // Known crawlers and AI agents, counted even on pages the CDN serves from
    // cache (where no route code runs). Only these user agents enter the
    // proxy for plain pages, so ordinary visitors never pay for it. Must stay
    // a literal (Next reads the matcher at build time); a test keeps it equal
    // to COUNTED_AGENT_PATTERN in ~/lib/proxy-rules.
    {
      source: "/((?!api/|phx9a/|_next/).*)",
      has: [
        {
          type: "header",
          key: "user-agent",
          value:
            ".*(?:ChatGPT-User|OAI-SearchBot|GPTBot|Claude-User|Claude-SearchBot|ClaudeBot|anthropic-ai|Perplexity|MistralAI-User|DuckAssistBot|GoogleAgent|Gemini-Deep-Research|Googlebot|bingbot|Applebot|meta-externalagent|CCBot|cohere-ai|YouBot).*",
        },
      ],
    },
  ],
};
