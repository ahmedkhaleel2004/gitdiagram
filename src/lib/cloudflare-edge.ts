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
  | "LIMIT_DIAGRAM_STATE";

const RATE_LIMITED_PATHS: Record<string, EdgeRateLimit> = {
  "/api/generate/stream": "LIMIT_GENERATE_STREAM", // 20 a minute
  "/api/generate/cost": "LIMIT_GENERATE_COST", // 60 a minute
  "/api/generate/cancel": "LIMIT_GENERATE_CANCEL", // 60 a minute
  "/api/diagram-state": "LIMIT_DIAGRAM_STATE", // 120 a minute
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

export type EdgeDecision =
  | { action: "deny"; rule: string }
  | { action: "limit"; limit: EdgeRateLimit }
  | null;

/** What the firewall does with a request before the app sees it. */
export function edgeDecision(
  pathname: string,
  userAgent: string | null,
): EdgeDecision {
  const limit = RATE_LIMITED_PATHS[pathname];
  if (limit) return { action: "limit", limit };
  const agent = userAgent ?? "";
  // 2026-07-08: ClaudeBot crawling thousands of unique repository pages.
  if (agent.includes("ClaudeBot") && isRepositoryRoute(pathname, false))
    return { action: "deny", rule: "claudebot-repository-crawl" };
  // Sep 2026: 221k crawler requests a week on pages and social pictures.
  if (agent.includes("Amazonbot") && isRepositoryRoute(pathname, true))
    return { action: "deny", rule: "amazonbot-repository-crawl" };
  if (agent === "Brightbot 1.0" && isRepositoryRoute(pathname, true))
    return { action: "deny", rule: "brightbot-repository-crawl" };
  return null;
}
