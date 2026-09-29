import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";
import { recordAgentFetch } from "~/server/visibility/agent-fetch";

const REJECTION_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

// First path segments that are the site's own, never a GitHub owner.
const RESERVED_FIRST_SEGMENTS = new Set([
  "api",
  "phx9a",
  "_next",
  "out",
  "sitemap",
  "admin",
  "mcp",
  ".well-known",
]);

/**
 * Where the Markdown twin of a repository page lives, when this request asks
 * for it: /{owner}/{repo}.md, or the page URL with `Accept: text/markdown`
 * (agents; browsers never send it). User agents are never sniffed.
 */
function markdownRoute(request: NextRequest): string | null {
  const match = /^\/([^/]+)\/([^/]+?)(\.md)?\/?$/.exec(
    request.nextUrl.pathname,
  );
  if (!match) return null;
  const [, owner, repo, extension] = match;
  if (!owner || !repo || RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase())) {
    return null;
  }
  const wantsMarkdown =
    Boolean(extension) ||
    /(?:^|,)\s*text\/markdown\s*(?:[;,]|$)/i.test(
      request.headers.get("accept") ?? "",
    );
  return wantsMarkdown ? `/${owner}/${repo}/llms.txt` : null;
}

/** Which part of the site a counted fetch was for. */
function fetchSurface(path: string, markdown: boolean): string {
  if (markdown) return "repo-md";
  if (path === "/") return "home";
  if (path === "/llms.txt" || path === "/llms-full.txt") return path.slice(1);
  if (/^\/[^/]+\/[^/]+\/video\/?$/.test(path)) return "watch";
  if (/^\/[^/]+\/[^/]+\/?$/.test(path)) return "repo";
  return path.split("/")[1]?.slice(0, 30) || "other";
}

/**
 * GitDiagram does not expose Server Actions. Reject forged action requests at
 * the proxy boundary so they never reach the Next.js action decoder.
 */
export function proxy(
  request: NextRequest,
  event?: NextFetchEvent,
): NextResponse {
  if (!request.headers.has("next-action")) {
    const markdown =
      request.method === "GET" || request.method === "HEAD"
        ? markdownRoute(request)
        : null;
    // Best effort, after the response: one Redis pipeline for known bots.
    const counted = recordAgentFetch(
      request.headers.get("user-agent"),
      fetchSurface(request.nextUrl.pathname, Boolean(markdown)),
    );
    event?.waitUntil(counted);
    // Only mixed-case repository URLs and Markdown requests enter this branch
    // in production. Keep query parameters (including PostHog campaign
    // attribution) on redirects.
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
      if (markdown) {
        url.pathname = markdown;
        return NextResponse.rewrite(url);
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
    // A repository page's Markdown twin (see markdownRoute).
    "/((?!api/|phx9a/|_next/)[^/]+/[^/]+\\.md)",
    {
      source: "/((?!api/|phx9a/|_next/)[^/]+/[^/]+)",
      has: [{ type: "header", key: "accept", value: ".*text/markdown.*" }],
    },
    // Known crawlers and AI agents, counted even on pages the CDN serves from
    // cache (where no route code runs). Only these user agents enter the
    // proxy for plain pages, so ordinary visitors never pay for it. Must stay
    // a literal (Next reads the matcher at build time).
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
