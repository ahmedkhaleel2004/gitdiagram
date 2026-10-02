// The Worker every request reaches first: `gitdiagram-edge`
// (wrangler.edge.jsonc), on gitdiagram.com's routes with the static files.
//
// It exists for one thing: a new isolate of it answers as fast as a warm one.
// It is about 20 KB with no Node compatibility, Durable Objects or
// containers, where the site's Worker behind it (`gitdiagram`,
// cloudflare/worker.ts: OpenNext's routing layer, the containers, the
// Durable Objects, 0.3 MB) takes about 70 ms longer from a new isolate than
// from a warm one, and a third of all requests are some isolate's first.
//
// So it answers the commonest requests itself and passes everything else on
// untouched, over a service binding, to the site's Worker, which is complete
// without it (the routes can be pointed back at `gitdiagram` at any time):
// - a cached page this location holds (`answerFromCopy`), after the
//   firewall's rules for it, with next.config.js's headers and 304s;
// - a page it does not hold, with one hop to the placed server
//   (`gitdiagram-server`), which hands over its cache entry or renders;
// - the two calls every page makes (`/api/sponsor`, `/api/analytics-context`).
// A request the Next.js proxy has a say in (a crawler to count, a Markdown
// twin, a mixed-case address) is the site's Worker's.
//
// Not part of the Vercel build; wrangler bundles it. The root tsconfig skips
// this folder: .open-next only exists after a build.

// The build's id and next.config.js headers for every path
// (scripts/cf-asset-headers.mjs).
import build from "../.open-next/build.json";
import siteHeaders from "../.open-next/site-headers.json";
import {
  analyticsContext,
  edgeDecision,
  isPagePath,
  isPlatformResponseHeader,
  matchesEtag,
  platformHeaders,
  runsWhereTheVisitorIs,
  visitorCacheControl,
  type CloudflareGeo,
  type EdgeRateLimit,
} from "../src/lib/cloudflare-edge";
import {
  ENTRY_ENCODING,
  ENTRY_WANTED,
  UNROUTED,
  answerFromCopy,
  answerFromEntry,
  plainPageKey,
} from "../src/lib/colo-cache";
import { entersProxy } from "../src/lib/proxy-rules";
import {
  SPONSOR_ANSWER_HEADERS,
  sponsorAnswer,
} from "../src/lib/sponsor-campaign";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

type RateLimits = { [Name in EdgeRateLimit]?: RateLimit };

interface Env extends RateLimits {
  /** The site's Worker (`gitdiagram`): everything this one does not answer. */
  SITE: Fetcher;
  /** The placed server, which a copy of a page is rechecked against. */
  SERVER?: Fetcher;
  /** See cloudflare/worker.ts; here it pins the rechecks. */
  SERVER_VERSION_OVERRIDE?: string;
  SPONSOR_PREVIEW_CAMPAIGN?: string;
  NEXT_INC_CACHE_R2_PREFIX?: string;
  CRON_SECRET?: string;
  SITE_ORIGIN?: string;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

const SITE_HOSTNAME = "gitdiagram.com";

/**
 * An answer of this Worker as the site's Worker would have sent it
 * (`visitorResponse` in cloudflare/worker.ts): without the cache directives
 * meant for the platform, with next.config.js's site-wide headers, and
 * `noindex` on any hostname but the site's.
 */
function visitorResponse(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  const cacheControl = headers.get("cache-control");
  if (cacheControl)
    headers.set("cache-control", visitorCacheControl(cacheControl));
  for (const name of [...headers.keys()])
    if (isPlatformResponseHeader(name)) headers.delete(name);
  for (const [name, value] of Object.entries(
    siteHeaders as Record<string, string>,
  ))
    if (!headers.has(name)) headers.set(name, value);
  if (
    url.hostname !== SITE_HOSTNAME &&
    !/\bnoindex\b/i.test(headers.get("x-robots-tag") ?? "")
  )
    headers.append("x-robots-tag", "noindex");
  return new Response(response.body, { status: response.status, headers });
}

/**
 * A browser that still holds a page asks again with the page's `ETag`
 * (pages are `max-age=0, must-revalidate`). When nothing changed the answer
 * is 304 and no body, as on Vercel; OpenNext sends the whole page again.
 */
function notModified(request: Request, response: Response): Response {
  if (
    response.status !== 200 ||
    (request.method !== "GET" && request.method !== "HEAD") ||
    !matchesEtag(
      request.headers.get("if-none-match"),
      response.headers.get("etag"),
    )
  )
    return response;
  void response.body?.cancel();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(null, { status: 304, headers });
}

/** The firewall rules Vercel ran in front of the app; null lets it through. */
async function firewall(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const decision = edgeDecision(
    pathname,
    request.headers.get("user-agent"),
    Boolean(
      (request as Request & { cf?: { verifiedBotCategory?: unknown } }).cf
        ?.verifiedBotCategory,
    ),
  );
  if (decision?.action === "deny")
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  if (decision?.action === "missing")
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  if (decision?.action === "limit") {
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";
    // A limiter that cannot answer never blocks a visitor.
    const allowed = await env[decision.limit]
      ?.limit({ key })
      .then((outcome) => outcome.success)
      .catch(() => true);
    if (allowed === false)
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": "60" },
      });
  }
  return null;
}

/**
 * This Worker's own answer to a request, or null when the site's Worker
 * answers it.
 */
async function ownAnswer(
  request: Request,
  env: Env,
  ctx: Context,
  url: URL,
): Promise<Response | null> {
  if (request.method !== "GET" || url.hostname === `www.${SITE_HOSTNAME}`)
    return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/sponsor")
    return Response.json(
      sponsorAnswer(url.hostname, Date.now(), env.SPONSOR_PREVIEW_CAMPAIGN),
      { headers: SPONSOR_ANSWER_HEADERS },
    );
  if (path === "/api/analytics-context")
    return Response.json(
      analyticsContext(
        platformHeaders(
          request.headers,
          (request as Request & { cf?: CloudflareGeo }).cf,
          url,
        ),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  // The Next.js proxy's rules (and its count of crawler fetches) are applied
  // by the site's Worker.
  if (entersProxy(url.pathname, request.headers)) return null;
  const key = plainPageKey(request, url);
  if (!key) return null;
  const held = await answerFromCopy(request, url, env, ctx, build.buildId);
  // The page is here; the firewall still has its say (a blocked crawler, the
  // per-address limit on repository pages), and counts the request once.
  if (held) return (await firewall(request, env, url.pathname)) ?? held;
  // Not here. A page goes straight to the placed server, which answers with
  // its cache entry or renders: one hop, without the site's Worker (whose
  // new isolates are slow) in between. What is not a page, or belongs to the
  // unplaced copy of the server, is the site's Worker's.
  if (
    !env.SERVER ||
    !isPagePath(url.pathname) ||
    runsWhereTheVisitorIs(request.method, url)
  )
    return null;
  const refused = await firewall(request, env, url.pathname);
  if (refused) return refused;
  const cf = (request as Request & { cf?: CloudflareGeo }).cf;
  // The request as the app saw it on Vercel, marked as the edge Worker's.
  const headers = platformHeaders(request.headers, cf, url);
  headers.set(ENTRY_WANTED, key);
  headers.set(UNROUTED, "1");
  if (env.SERVER_VERSION_OVERRIDE)
    headers.set(
      "Cloudflare-Workers-Version-Overrides",
      env.SERVER_VERSION_OVERRIDE,
    );
  let answer: Response;
  const askedAt = Date.now();
  try {
    answer = await env.SERVER.fetch(
      new Request(request, { headers, redirect: "manual", cf } as RequestInit),
    );
  } catch {
    // The site's Worker asks again (and once more if the server's isolate
    // died under the request).
    return null;
  }
  if (answer.status === 503) {
    void answer.body?.cancel();
    return null;
  }
  // Rendered (or redirected, or refused) by the server.
  if (!answer.headers.has(ENTRY_ENCODING)) {
    serverTrips.set(request, `render;dur=${Date.now() - askedAt}`);
    return answer;
  }
  // The server had the page: it is kept here and answered from.
  const page = await answerFromEntry(key, answer, env, ctx, build.buildId);
  serverTrips.set(request, `origin;dur=${Date.now() - askedAt}`);
  return page;
}

// How long the trip to the server took, for the request's Server-Timing.
const serverTrips = new WeakMap<Request, string>();

let isolateHasServed = false;

const edge = {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    const startedAt = Date.now();
    const firstInIsolate = !isolateHasServed;
    isolateHasServed = true;
    const own = await ownAnswer(request, env, ctx, url);
    // Not this Worker's: the request goes on as it came (`cf`, the visitor's
    // place and network, by name).
    if (!own)
      return env.SITE.fetch(
        new Request(request, {
          redirect: "manual",
          cf: (request as Request & { cf?: object }).cf,
        } as RequestInit),
      );
    const answer = notModified(request, visitorResponse(own, url));
    // For anyone measuring from outside, as the site's Worker does for its
    // own answers: the time until the answer's headers were ready (I/O only;
    // a Worker's clock stands still while it computes), whether the request
    // started a new isolate, and the trip to the server if there was one
    // (`origin`: it had the page; `render`: it rendered it).
    const trip = serverTrips.get(request);
    answer.headers.append(
      "server-timing",
      `edge;dur=${Date.now() - startedAt};desc="${firstInIsolate ? "new isolate" : "warm"}"${trip ? `, ${trip}` : ""}`,
    );
    return answer;
  },
};

export default edge;
