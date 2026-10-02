// Pure helpers for the Cloudflare Worker entry (cloudflare/worker.ts). They
// make a request on Cloudflare look to the app like one on Vercel, so the
// route code is the same on both.

/** What Cloudflare knows about the caller (`request.cf`). */
export interface CloudflareGeo {
  country?: unknown;
  regionCode?: unknown;
  city?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

// Headers the platform owns. A caller's own copies are always dropped, so
// nobody can claim a place or an address.
const PLATFORM_HEADERS = [
  "x-vercel-ip-country",
  "x-vercel-ip-country-region",
  "x-vercel-ip-city",
  "x-vercel-ip-latitude",
  "x-vercel-ip-longitude",
  "x-vercel-ip-timezone",
  "x-vercel-ip-continent",
  "x-vercel-ip-postal-code",
  "x-vercel-forwarded-for",
  "x-vercel-deployment-url",
  "x-vercel-id",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
];

const text = (value: unknown, pattern: RegExp): string =>
  typeof value === "string" && pattern.test(value) ? value : "";

/**
 * The request headers the app should see: the caller's, minus anything the
 * platform owns, plus Vercel-style geolocation and client-address headers
 * filled from Cloudflare's own knowledge of the connection.
 */
export function platformHeaders(
  incoming: Headers,
  cf: CloudflareGeo | undefined,
  url: URL,
): Headers {
  const headers = new Headers(incoming);
  for (const name of PLATFORM_HEADERS) headers.delete(name);
  // The same-origin guard reads these; they are the platform's to state.
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(/:$/, ""));

  const ip = incoming.get("cf-connecting-ip")?.trim();
  if (ip) {
    headers.set("x-forwarded-for", ip);
    headers.set("x-real-ip", ip);
  }

  // "T1" (Tor) and "XX" (unknown) are not countries.
  const country = text(cf?.country, /^[A-Z]{2}$/);
  if (country && country !== "XX" && country !== "T1")
    headers.set("x-vercel-ip-country", country);
  const region = text(cf?.regionCode, /^[A-Z0-9]{1,3}$/);
  if (region) headers.set("x-vercel-ip-country-region", region);
  // Vercel percent-encodes the city.
  if (typeof cf?.city === "string" && cf.city && cf.city.length <= 100)
    headers.set("x-vercel-ip-city", encodeURIComponent(cf.city));
  const latitude = text(cf?.latitude, /^-?\d{1,3}(?:\.\d+)?$/);
  const longitude = text(cf?.longitude, /^-?\d{1,3}(?:\.\d+)?$/);
  if (latitude && longitude) {
    headers.set("x-vercel-ip-latitude", latitude);
    headers.set("x-vercel-ip-longitude", longitude);
  }
  return headers;
}

/**
 * The Cache-Control a visitor should get. `s-maxage` (and the
 * stale-while-revalidate that goes with it) speaks to the platform's own
 * cache: Vercel's CDN consumes it and never sends it on, and on Cloudflare
 * OpenNext's cache has already acted on it. Left in, any proxy between the
 * site and the visitor could keep a page for that long.
 */
export function visitorCacheControl(value: string): string {
  const directives = value
    .split(",")
    .map((directive) => directive.trim())
    .filter(Boolean);
  if (!directives.some((directive) => /^s-maxage=/i.test(directive)))
    return value;
  const kept = directives.filter(
    (directive) => !/^(?:s-maxage|stale-while-revalidate)=/i.test(directive),
  );
  return kept.length ? kept.join(", ") : "public, max-age=0, must-revalidate";
}

/** Response headers only Vercel's CDN reads; it strips them, so do we. */
export const isPlatformResponseHeader = (name: string): boolean =>
  /^vercel-/i.test(name);

/**
 * Routes that run ffmpeg or Chromium, which a Worker cannot: the Worker hands
 * them to the render Container. `GET /api/video` and the other video routes
 * stay on the Worker.
 */
export function isContainerPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  return (
    path === "/api/video/generate" ||
    path === "/api/video/render" ||
    path === "/api/video/render/segment"
  );
}

/**
 * What the Worker can answer for a container route without waking a
 * container (which costs a few seconds and bills while awake): the same
 * refusals the route itself gives, in the same order. Null means the request
 * goes to a container. Segment jobs are signed; their check is the router's.
 */
export function containerRefusal(
  method: string,
  pathname: string,
  origin: string | null,
  url: URL,
): { status: number; error?: string } | null {
  if (method !== "POST") return { status: 405 };
  const path = pathname.replace(/\/+$/, "");
  if (path === "/api/video/render/segment") return null;
  let sameOrigin = false;
  try {
    sameOrigin = origin !== null && new URL(origin).origin === url.origin;
  } catch {
    sameOrigin = false;
  }
  if (sameOrigin) return null;
  return {
    status: 403,
    error:
      path === "/api/video/generate"
        ? "Video generation must come from GitDiagram."
        : "Video downloads must come from GitDiagram.",
  };
}

/** The internal route each cron schedule calls (same as vercel.json). */
export const CRON_ROUTES: Record<string, string> = {
  "*/5 * * * *": "/api/internal/browse-index/drain",
  "*/15 * * * *": "/api/internal/video-payments/sweep",
  "0 13 * * *": "/api/internal/ai-visibility",
};

// ---------------------------------------------------------------------------
// The Vercel firewall's custom rules (config version 12, 2026-09-19), as far
// as a Worker can enforce them. The two "challenge" rules (hosting networks
// and two scraper browser signatures on repository pages) need Cloudflare's
// own challenge, so they are WAF rules on the zone, not code here.

/** A rate-limit binding in wrangler.jsonc: requests per 60 s per address. */
export type EdgeRateLimit =
  | "LIMIT_GENERATE_STREAM"
  | "LIMIT_GENERATE_COST"
  | "LIMIT_GENERATE_CANCEL"
  | "LIMIT_DIAGRAM_STATE"
  | "LIMIT_VIDEO_START"
  | "LIMIT_REPO_PAGE";

const RATE_LIMITED_PATHS: Record<string, EdgeRateLimit> = {
  "/api/generate/stream": "LIMIT_GENERATE_STREAM", // 20 a minute
  "/api/generate/cost": "LIMIT_GENERATE_COST", // 60 a minute
  "/api/generate/cancel": "LIMIT_GENERATE_CANCEL", // 60 a minute
  "/api/diagram-state": "LIMIT_DIAGRAM_STATE", // 120 a minute
  // Not a Vercel rule: these two wake a container, which bills while awake.
  // The routes' own limits (Redis) run inside it, so this one stands in
  // front. Far above what a person does (a video or an MP4 takes a minute).
  "/api/video/generate": "LIMIT_VIDEO_START", // 30 a minute
  "/api/video/render": "LIMIT_VIDEO_START",
};

// First path segments that are the site's own, never a GitHub owner.
const OWN_FIRST_SEGMENTS = new Set([
  "api",
  "phx9a",
  "_next",
  "out",
  "sitemap",
  "admin",
  "mcp",
  "mcp-app",
  ".well-known",
  "video-engine",
  "sponsors",
  "sponsor-previews",
  "og-fonts",
]);

/** `/owner/repo`, or with `images` its social pictures too. */
function isRepositoryRoute(pathname: string, images: boolean): boolean {
  const match =
    /^\/([^/]+)\/[^/]+(\/(?:opengraph-image|twitter-image))?\/?$/.exec(
      pathname,
    );
  if (!match?.[1] || OWN_FIRST_SEGMENTS.has(match[1].toLowerCase()))
    return false;
  return images || !match[2];
}

/**
 * Paths only vulnerability scanners ask for (`/wp-login.php`, `/.env`,
 * `/s3/.aws/config`, `/vendor/phpunit/.../eval-stdin.php`). The app would
 * answer each with its rendered 404 page, at 30 to 400 ms of billed CPU; the
 * Worker answers them itself. Nothing the site serves matches: its own
 * dot-folder is `.well-known`, and a repository page (`/owner/.github`,
 * `/owner/tool.php`) is two segments whose first is a GitHub name.
 */
export function isScannerPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const [first] = segments;
  if (!first) return false;
  if (first.startsWith(".")) return first !== ".well-known";
  if (/\.(?:php\d?|aspx?|jsp|cgi|env)$/i.test(pathname))
    return segments.length !== 2;
  return (
    segments.length > 2 &&
    !OWN_FIRST_SEGMENTS.has(first.toLowerCase()) &&
    segments.some((segment) => segment.startsWith("."))
  );
}

export type EdgeDecision =
  | { action: "deny"; rule: string }
  | { action: "missing" }
  | { action: "limit"; limit: EdgeRateLimit }
  | null;

/**
 * What the firewall does with a request before the app sees it.
 * `verifiedCrawler`: Cloudflare has confirmed the caller is a known search
 * engine or other good bot (`request.cf.verifiedBotCategory`).
 */
export function edgeDecision(
  pathname: string,
  userAgent: string | null,
  verifiedCrawler = false,
): EdgeDecision {
  const limit = RATE_LIMITED_PATHS[pathname];
  if (limit) return { action: "limit", limit };
  if (isScannerPath(pathname)) return { action: "missing" };
  const agent = userAgent ?? "";
  // 2026-07-08: ClaudeBot crawling thousands of unique repository pages.
  if (agent.includes("ClaudeBot") && isRepositoryRoute(pathname, false))
    return { action: "deny", rule: "claudebot-repository-crawl" };
  // Sep 2026: 221k crawler requests a week on pages and social pictures.
  if (agent.includes("Amazonbot") && isRepositoryRoute(pathname, true))
    return { action: "deny", rule: "amazonbot-repository-crawl" };
  if (agent === "Brightbot 1.0" && isRepositoryRoute(pathname, true))
    return { action: "deny", rule: "brightbot-repository-crawl" };
  // Not a Vercel rule. A repository page that is not cached yet costs a
  // render (about 150 ms of CPU) and two R2 writes, and there is no end of
  // names to ask for. 120 a minute is far above a person, and room for a
  // classroom behind one address; search engines Cloudflare has verified are never held back.
  if (!verifiedCrawler && isRepositoryRoute(pathname, true))
    return { action: "limit", limit: "LIMIT_REPO_PAGE" };
  return null;
}

// ---------------------------------------------------------------------------
// The shared cache for route answers. On Vercel a route handler that answers
// with `s-maxage` (or `CDN-Cache-Control`) is kept by the CDN and later
// requests never reach a function. On Cloudflare a Worker's answer is not
// cached by the CDN, so the Worker entry keeps such answers itself, in the
// Cache API of each location (cloudflare/worker.ts).

/** The named Cache API cache both Workers use for these answers. */
export const EDGE_ANSWERS_CACHE = "edge-answers";

/** A year: what "immutable" answers ask for, and the longest we keep one. */
const LONGEST_SECONDS = 365 * 24 * 60 * 60;

const directiveSeconds = (value: string, name: string): number | null => {
  const match = new RegExp(`(?:^|,)\\s*${name}=(\\d+)`, "i").exec(value);
  return match ? Math.min(Number(match[1]), LONGEST_SECONDS) : null;
};

/**
 * How long a shared cache may answer with this response: `fresh` seconds as
 * is, then `stale` more while a new copy is fetched. Null when it must not be
 * kept at all. `CDN-Cache-Control` wins over `Cache-Control: s-maxage`, as on
 * Vercel; a browser-only `max-age` is not a shared lifetime.
 */
export function sharedLifetime(
  status: number,
  headers: Headers,
): { fresh: number; stale: number } | null {
  if (status !== 200 || headers.has("set-cookie")) return null;
  const cacheControl = headers.get("cache-control") ?? "";
  if (/\b(?:private|no-store)\b/i.test(cacheControl)) return null;
  const cdn = headers.get("cdn-cache-control");
  if (cdn !== null) {
    if (/\b(?:private|no-store)\b/i.test(cdn)) return null;
    const fresh =
      directiveSeconds(cdn, "s-maxage") ?? directiveSeconds(cdn, "max-age");
    if (fresh === null || fresh <= 0) return null;
    return {
      fresh,
      stale: directiveSeconds(cdn, "stale-while-revalidate") ?? 0,
    };
  }
  const fresh = directiveSeconds(cacheControl, "s-maxage");
  if (fresh === null || fresh <= 0) return null;
  return {
    fresh,
    stale: directiveSeconds(cacheControl, "stale-while-revalidate") ?? 0,
  };
}

/**
 * Whether a request may be answered from, and its answer kept in, the shared
 * cache: reads of API routes only. Pages and their pictures have Next.js's
 * own cache (with tag revalidation); a caller who sends credentials or asks
 * for part of a file gets the route itself.
 */
export function isSharedCacheRequest(
  method: string,
  pathname: string,
  headers: Headers,
): boolean {
  return (
    method === "GET" &&
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/internal/") &&
    !pathname.startsWith("/api/admin/") &&
    !headers.has("authorization") &&
    !headers.has("range")
  );
}

/**
 * The address an answer is kept under: the host, the path and the query with
 * its parameters in order (so `?a=1&b=2` and `?b=2&a=1` share a copy).
 */
export function edgeAnswerKey(url: URL): string {
  const query = [...url.searchParams.entries()]
    .sort(([a, x], [b, y]) =>
      a === b ? x.localeCompare(y) : a.localeCompare(b),
    )
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  return `http://edge-answers.local/${url.host}${url.pathname}${query ? `?${query}` : ""}`;
}

/**
 * The answer of GET /api/analytics-context: the caller's coarse place, from
 * the platform's geolocation headers (never the address itself). One function
 * for the route and for the Worker entry, which answers this call itself.
 */
export function analyticsContext(headers: {
  get(name: string): string | null;
}) {
  const country = headers.get("x-vercel-ip-country") ?? "";
  const region = headers.get("x-vercel-ip-country-region") ?? "";
  return {
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    region: /^[A-Z0-9]{1,3}$/.test(region) ? region : "",
  };
}
