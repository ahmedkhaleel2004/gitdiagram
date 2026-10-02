// The rules of the Next.js proxy (src/proxy.ts) as plain functions, so the
// Cloudflare Worker entry (cloudflare/worker.ts) can apply the very same ones
// without loading Next.js: the Cloudflare build leaves the proxy out
// (scripts/cf-drop-proxy.mjs).

interface HeaderReader {
  get(name: string): string | null;
}

// First path segments that are the site's own, never a GitHub owner.
const RESERVED_FIRST_SEGMENTS = new Set([
  "api",
  "phx9a",
  "_next",
  "out",
  "sitemap",
  "admin",
  "mcp",
  "mcp-app",
  ".well-known",
]);

/**
 * Search-engine crawlers and AI agents whose page fetches are counted. The
 * proxy's matcher repeats this list as a literal (Next reads the matcher at
 * build time); a test keeps the two equal.
 */
export const COUNTED_AGENT_PATTERN =
  "(?:ChatGPT-User|OAI-SearchBot|GPTBot|Claude-User|Claude-SearchBot|ClaudeBot|anthropic-ai|Perplexity|MistralAI-User|DuckAssistBot|GoogleAgent|Gemini-Deep-Research|Googlebot|bingbot|Applebot|meta-externalagent|CCBot|cohere-ai|YouBot)";

const COUNTED_AGENT = new RegExp(COUNTED_AGENT_PATTERN);
const MARKDOWN_ACCEPT = /(?:^|,)\s*text\/markdown\s*(?:[;,]|$)/i;
const NOT_PAGES = /^\/(?:api|phx9a|_next)\//;

/**
 * Where the Markdown twin of a repository page lives, when this request asks
 * for it: /{owner}/{repo}.md, or the page URL with `Accept: text/markdown`
 * (agents; browsers never send it). User agents are never sniffed.
 */
function markdownRoute(pathname: string, accept: string | null): string | null {
  const match = /^\/([^/]+)\/([^/]+?)(\.md)?\/?$/.exec(pathname);
  if (!match) return null;
  const [, owner, repo, extension] = match;
  if (!owner || !repo || RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase())) {
    return null;
  }
  const wantsMarkdown =
    Boolean(extension) || MARKDOWN_ACCEPT.test(accept ?? "");
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

/** The lowercase address of a mixed-case repository URL, else null. */
function canonicalRepositoryPath(pathname: string): string | null {
  return !/^\/(?:api|phx9a|_next)\//i.test(pathname) &&
    /^\/[^/]+\/[^/]+(?:\/opengraph-image)?\/?$/.test(pathname) &&
    pathname !== pathname.toLowerCase()
    ? pathname.toLowerCase()
    : null;
}

export type ProxyDecision =
  /** A forged Server Action: 404, never cached. */
  | { action: "reject" }
  /** A mixed-case repository URL: 308 to this path, query kept. */
  | { action: "redirect"; pathname: string }
  /** The Markdown twin: serve this path on the requested URL. */
  | { action: "rewrite"; pathname: string }
  | { action: "next" };

/**
 * What the proxy does with a request, and the surface its fetch is counted
 * under when a known crawler made it (null for a rejected request).
 */
export function proxyDecision(
  method: string,
  pathname: string,
  headers: HeaderReader,
): { decision: ProxyDecision; surface: string | null } {
  if (headers.get("next-action") !== null)
    return { decision: { action: "reject" }, surface: null };
  const reads = method === "GET" || method === "HEAD";
  const markdown = reads
    ? markdownRoute(pathname, headers.get("accept"))
    : null;
  const surface = fetchSurface(pathname, Boolean(markdown));
  if (!reads) return { decision: { action: "next" }, surface };
  // Only mixed-case repository URLs and Markdown requests get past here in
  // production.
  const canonical = canonicalRepositoryPath(pathname);
  if (canonical)
    return { decision: { action: "redirect", pathname: canonical }, surface };
  if (markdown)
    return { decision: { action: "rewrite", pathname: markdown }, surface };
  return { decision: { action: "next" }, surface };
}

/**
 * Whether a request enters the proxy at all: its `config.matcher`, for the
 * Worker, which has no Next.js in front to apply it. Everything else (an
 * ordinary visitor on an ordinary page) is never looked at.
 */
export function entersProxy(pathname: string, headers: HeaderReader): boolean {
  if (headers.get("next-action") !== null) return true;
  if (NOT_PAGES.test(`${pathname}/`)) return false;
  // Mixed-case repository URLs (and their social picture).
  if (
    /^\/(?=[^/]*[A-Z]|[^/]+\/[^/]*[A-Z])[^/]+\/[^/]+(?:\/opengraph-image)?\/?$/.test(
      pathname,
    )
  )
    return true;
  // A repository page's Markdown twin, by extension or by Accept.
  if (/^\/[^/]+\/[^/]+\.md\/?$/.test(pathname)) return true;
  if (
    /^\/[^/]+\/[^/]+\/?$/.test(pathname) &&
    /text\/markdown/.test(headers.get("accept") ?? "")
  )
    return true;
  // Known crawlers and AI agents, counted on every page.
  return COUNTED_AGENT.test(headers.get("user-agent") ?? "");
}
