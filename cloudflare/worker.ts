// The site's entry on Cloudflare Workers: the small Worker every request
// reaches first (`gitdiagram`, wrangler.jsonc). It holds OpenNext's routing
// layer (`bun run cf:build` writes .open-next/): the proxy, redirects, and
// the page cache, so a cached page is answered here. Everything that needs
// the Next.js server goes on to a second Worker, `gitdiagram-server`
// (cloudflare/server.ts), over a service binding. The split is for start-up
// time: a new isolate of this Worker loads about 0.3 MB of script, the server
// about 32 MB, and most requests (cached pages, static files' neighbours, the
// analytics proxy) never need the server.
//
// Around that it does what Vercel's platform did: geolocation and
// client-address headers, the firewall, cron, and the hand-off of
// ffmpeg/Chromium routes to the render Container.
//
// Not part of the Vercel build; wrangler bundles it. The root tsconfig skips
// this folder: .open-next only exists after a build.

import { handleImageRequest } from "../.open-next/cloudflare/images.js";
import { runWithCloudflareRequestContext } from "../.open-next/cloudflare/init.js";
import { handler as routingLayer } from "../.open-next/middleware/handler.mjs";
// next.config.js headers for every path (scripts/cf-asset-headers.mjs).
import siteHeaders from "../.open-next/site-headers.json";
import { agentFetchCommands } from "../src/lib/agent-families";
import {
  SPONSOR_ANSWER_HEADERS,
  sponsorAnswer,
} from "../src/lib/sponsor-campaign";
import {
  CRON_ROUTES,
  analyticsContext,
  containerRefusal,
  edgeDecision,
  isContainerPath,
  runsWhereTheVisitorIs,
  isPlatformResponseHeader,
  matchesEtag,
  platformHeaders,
  visitorCacheControl,
  type CloudflareGeo,
  type EdgeRateLimit,
} from "../src/lib/cloudflare-edge";

import {
  ENTRY_ENCODING,
  ENTRY_WANTED,
  UNROUTED,
  cacheTimings,
  keepEntryFromServer,
  markTiming,
  takeWantedEntry,
} from "../src/lib/colo-cache";
import { entersProxy, proxyDecision } from "../src/lib/proxy-rules";

import {
  forwardToRender,
  warmContainers,
  type RenderEnv,
} from "../workers/render/src/container";

import { withEdgeAnswers } from "./edge-answers";
import "./outgoing-fetch";

// Read by src/lib/colo-cache.ts: this Worker only routes and answers
// cached pages.
(
  globalThis as { __GITDIAGRAM_ROUTING_WORKER__?: boolean }
).__GITDIAGRAM_ROUTING_WORKER__ = true;

// OpenNext's Durable Objects: the revalidation queue and the tag cache. They
// live in this Worker so that waking one loads the small script.
export { DOQueueHandler } from "../.open-next/.build/durable-objects/queue.js";
export { DOShardedTagCache } from "../.open-next/.build/durable-objects/sharded-tag-cache.js";
// Model API calls sent as the server's own (wrangler.jsonc: US_RELAY).
export { UsRelay } from "./us-relay";
// The render containers' Durable Object classes (wrangler.jsonc binds them).
export {
  GenerateContainer,
  RenderContainer,
} from "../workers/render/src/container";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

type RateLimits = { [Name in EdgeRateLimit]?: RateLimit };

// RenderEnv: the render containers' bindings (RENDER, GENERATE) and settings.
interface Env extends RateLimits, RenderEnv {
  WORKER_SELF_REFERENCE: Fetcher;
  /** The Next.js server (cloudflare/server.ts, Worker `gitdiagram-server`). */
  SERVER: Fetcher;
  /**
   * The same server where the visitor is (`gitdiagram-server-local`), for
   * what is long or heavy: see `runsWhereTheVisitorIs`.
   */
  SERVER_LOCAL?: Fetcher;
  /**
   * The server version uploaded with this version of the Worker, as a
   * Cloudflare-Workers-Version-Overrides value (scripts/cf-deploy.sh). While
   * a deploy is rolling out, requests are pinned to it so routing and
   * rendering come from the same build.
   */
  SERVER_VERSION_OVERRIDE?: string;
  SPONSOR_PREVIEW_CAMPAIGN?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  CRON_SECRET?: string;
  SITE_ORIGIN?: string;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

const SITE_HOSTNAME = "gitdiagram.com";
/** The cron whose every run also checks for a new container image to warm. */
const WARM_CRON = "*/5 * * * *";

const IMAGE_PATH = "/_next/image";

/**
 * Counts a page fetch by a known crawler or AI agent (one Redis pipeline,
 * after the response; src/server/visibility/agent-fetch.ts does the same on
 * the server). Never throws and never slows the answer.
 */
function countAgentFetch(
  env: Env,
  ctx: Context,
  userAgent: string | null,
  surface: string,
): void {
  const commands = agentFetchCommands(userAgent, surface);
  const base = env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  if (!commands || !base || !env.UPSTASH_REDIS_REST_TOKEN) return;
  ctx.waitUntil(
    fetch(`${base}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(5_000),
    }).then(
      (response) => response.body?.cancel(),
      () => undefined,
    ),
  );
}

/**
 * The Next.js proxy (src/proxy.ts), which the Cloudflare build leaves out
 * (scripts/cf-drop-proxy.mjs): the same rules, applied here. Returns the
 * proxy's own answer, or the request to route (rewritten for the Markdown
 * twin of a repository page).
 */
function proxied(
  request: Request,
  env: Env,
  ctx: Context,
  url: URL,
): Request | Response {
  if (!entersProxy(url.pathname, request.headers)) return request;
  const { decision, surface } = proxyDecision(
    request.method,
    url.pathname,
    request.headers,
  );
  if (decision.action === "reject")
    return new Response(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  if (surface !== null)
    countAgentFetch(env, ctx, request.headers.get("user-agent"), surface);
  if (decision.action === "next") return request;
  const target = new URL(url);
  target.pathname = decision.pathname;
  return decision.action === "redirect"
    ? new Response(null, {
        status: 308,
        headers: { Location: `${target.pathname}${target.search}` },
      })
    : new Request(target, request);
}

/**
 * Two calls every page makes that need nothing the server has: the sponsor
 * on show (the clock) and the visitor's coarse place (the request). Answered
 * here they cost no trip to the server Worker; the routes
 * (src/app/api/sponsor, src/app/api/analytics-context) share the functions.
 */
function answeredHere(request: Request, env: Env, url: URL): Response | null {
  if (request.method !== "GET") return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/sponsor")
    return Response.json(
      sponsorAnswer(url.hostname, Date.now(), env.SPONSOR_PREVIEW_CAMPAIGN),
      { headers: SPONSOR_ANSWER_HEADERS },
    );
  if (path === "/api/analytics-context")
    return Response.json(analyticsContext(request.headers), {
      headers: { "Cache-Control": "private, no-store" },
    });
  return null;
}

/**
 * The app: the proxy's rules, then OpenNext's routing layer, which answers
 * what it can by itself (redirects, rewrites to PostHog, cached pages); what
 * is left is a request for the Next.js server.
 */
const handler = {
  fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    return runWithCloudflareRequestContext(request, env, ctx, async () => {
      const url = new URL(request.url);
      // next/image's default loader (the sponsor pictures on /advertise).
      if (url.pathname === IMAGE_PATH)
        return handleImageRequest(url, request.headers, env);
      const incoming = proxied(request, env, ctx, url);
      if (incoming instanceof Response) return incoming;
      const routed = await routingLayer(incoming, env, ctx);
      if (routed instanceof Response) return routed;
      // `cf` (the visitor's place and network) goes along by name: server
      // code reads it (src/server/model-fetch.ts).
      const toServer = async (
        routedRequest: Request,
        entryWanted?: string,
      ): Promise<Response> => {
        const forwarded = new Request(routedRequest, {
          redirect: "manual",
          cf: (request as Request & { cf?: object }).cf,
        } as RequestInit);
        if (env.SERVER_VERSION_OVERRIDE)
          forwarded.headers.set(
            "Cloudflare-Workers-Version-Overrides",
            env.SERVER_VERSION_OVERRIDE,
          );
        // Only this Worker says which entry it wants, never a visitor.
        if (entryWanted) forwarded.headers.set(ENTRY_WANTED, entryWanted);
        else forwarded.headers.delete(ENTRY_WANTED);
        // Routed here; a visitor's own copy of this header means nothing.
        forwarded.headers.delete(UNROUTED);
        // Long or memory-heavy work stays out of the placed server.
        if (runsWhereTheVisitorIs(request.method, url))
          return (env.SERVER_LOCAL ?? env.SERVER).fetch(forwarded);
        // A read can be asked twice. When the server's isolate dies under
        // the request (out of memory: Cloudflare ends everything it was
        // running) the answer is an error or a bare 503; the second try
        // lands in a new isolate.
        const retryable = request.method === "GET" || request.method === "HEAD";
        try {
          const answer = await env.SERVER.fetch(
            retryable ? forwarded.clone() : forwarded,
          );
          if (!retryable || answer.status !== 503) return answer;
          void answer.body?.cancel();
        } catch (error) {
          if (!retryable) throw error;
        }
        console.warn(
          JSON.stringify({ event: "server.retried", path: url.pathname }),
        );
        return env.SERVER.fetch(forwarded);
      };
      // The page cache found no copy of this page in this location
      // (src/lib/colo-cache.ts): the server may answer with its entry
      // instead of a page.
      const entryWanted =
        request.method === "GET" ? takeWantedEntry(ctx) : undefined;
      if (!entryWanted) return toServer(routed);
      const askedAt = Date.now();
      const answer = await toServer(routed, entryWanted);
      if (!answer.headers.has(ENTRY_ENCODING)) return answer;
      const kept = await keepEntryFromServer(ctx, entryWanted, answer);
      markTiming(ctx, "origin", Date.now() - askedAt);
      // With the entry here, the routing layer answers the request itself.
      const again = kept ? await routingLayer(incoming, env, ctx) : routed;
      if (again instanceof Response) return again;
      takeWantedEntry(ctx);
      return toServer(again);
    });
  },
};

/**
 * The app's response as Vercel would have passed it on: without the cache
 * directives and headers meant for the platform, and with next.config.js's
 * site-wide headers on the answers OpenNext leaves them off (redirects, the
 * proxy's own answers). On the PostHog rewrite and on a container's answers
 * (an image built without the Worker's settings) they replace what is there.
 */
function visitorResponse(
  response: Response,
  url: URL,
  replaceSiteHeaders = url.pathname.startsWith("/phx9a/"),
): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  const cacheControl = headers.get("cache-control");
  if (cacheControl)
    headers.set("cache-control", visitorCacheControl(cacheControl));
  for (const name of [...headers.keys()])
    if (isPlatformResponseHeader(name)) headers.delete(name);
  // The Markdown twin of a repository page answers on the page's own URL.
  if (
    headers.get("content-type")?.startsWith("text/markdown") &&
    !/\baccept\b/i.test(headers.get("vary") ?? "")
  )
    headers.append("vary", "Accept");
  for (const [name, value] of Object.entries(
    siteHeaders as Record<string, string>,
  ))
    if (replaceSiteHeaders || !headers.has(name)) headers.set(name, value);
  // Only the real site belongs in search results, not its copy on
  // workers.dev (Vercel does the same on its own hostnames).
  if (
    url.hostname !== SITE_HOSTNAME &&
    !/\bnoindex\b/i.test(headers.get("x-robots-tag") ?? "")
  )
    headers.append("x-robots-tag", "noindex");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

const asVercelRequest = (request: Request): Request =>
  new Request(request, {
    headers: platformHeaders(
      request.headers,
      (request as Request & { cf?: CloudflareGeo }).cf,
      new URL(request.url),
    ),
  });

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

async function respond(
  request: Request,
  env: Env,
  ctx: Context,
  url: URL,
): Promise<Response> {
  // On Vercel the www domain redirected to the apex.
  if (url.hostname === `www.${SITE_HOSTNAME}`) {
    url.hostname = SITE_HOSTNAME;
    return new Response(null, {
      status: 308,
      headers: { Location: url.toString() },
    });
  }
  // The server Worker's own paths (it hands cache entries to this Worker
  // there) are not the visitor's to ask for.
  if (url.pathname.startsWith("/__gitdiagram/"))
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  const refused = await firewall(request, env, url.pathname);
  if (refused) return refused;
  const forwarded = asVercelRequest(request);
  return (
    answeredHere(forwarded, env, url) ??
    withEdgeAnswers(request, url, ctx, () => handler.fetch(forwarded, env, ctx))
  );
}

/**
 * The ffmpeg and Chromium routes, which run in the render containers. The
 * Worker answers what it can itself, so a stray request never wakes one.
 */
async function container(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const refusal = containerRefusal(
    request.method,
    url.pathname,
    request.headers.get("origin"),
    url,
  );
  if (refusal)
    return refusal.error
      ? Response.json(
          { ok: false, error: refusal.error },
          { status: refusal.status, headers: { "Cache-Control": "no-store" } },
        )
      : new Response(null, { status: refusal.status });
  const limited = await firewall(request, env, url.pathname);
  if (limited) return limited;
  const forwarded = asVercelRequest(request);
  // Segments spread over the render pool and fail over between instances
  // themselves; see workers/render.
  if (url.pathname.replace(/\/+$/, "").endsWith("/segment"))
    return forwardToRender(forwarded, env);
  // A deploy replaces the container instances. For a few seconds the one a
  // request is sent to may be gone, which throws here rather than answering;
  // the next try reaches its replacement. The bodies are a few hundred bytes.
  const body = await forwarded.arrayBuffer();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await forwardToRender(new Request(forwarded, { body }), env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "container.unreachable",
          path: url.pathname,
          attempt,
          error: error instanceof Error ? error.message.slice(0, 200) : "?",
        }),
      );
      if (request.signal.aborted || attempt === 4)
        return Response.json(
          {
            ok: false,
            error: "Videos are unavailable for a moment. Try again shortly.",
          },
          {
            status: 503,
            headers: { "Cache-Control": "no-store", "Retry-After": "5" },
          },
        );
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

let isolateHasServed = false;

const worker = {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    if (isContainerPath(url.pathname))
      return visitorResponse(await container(request, env, url), url, true);
    const startedAt = Date.now();
    const firstInIsolate = !isolateHasServed;
    isolateHasServed = true;
    const answer = notModified(
      request,
      visitorResponse(await respond(request, env, ctx, url), url),
    );
    // For anyone measuring from outside: the time until this Worker had its
    // answer's headers (I/O only; a Worker's clock stands still while it
    // computes), whether the request started a new isolate, and what the
    // page cache had to fetch.
    answer.headers.append(
      "server-timing",
      [
        `edge;dur=${Date.now() - startedAt};desc="${firstInIsolate ? "new isolate" : "warm"}"`,
        // `origin`: this location had no copy of the page and asked the
        // server Worker for the entry.
        ...cacheTimings(ctx),
      ].join(", "),
    );
    return answer;
  },

  // Cloudflare cron triggers stand in for Vercel's crons: the same routes,
  // called the same way (GET with `Authorization: Bearer CRON_SECRET`).
  async scheduled(
    controller: { cron: string },
    env: Env,
    ctx: Context,
  ): Promise<void> {
    const path = CRON_ROUTES[controller.cron];
    if (!path) {
      console.error(
        JSON.stringify({ event: "cron.unknown", cron: controller.cron }),
      );
      return;
    }
    const origin = env.SITE_ORIGIN ?? "https://gitdiagram.com";
    const run = (async () => {
      const startedAt = Date.now();
      try {
        const response = await env.WORKER_SELF_REFERENCE.fetch(
          new Request(`${origin}${path}`, {
            headers: {
              authorization: `Bearer ${env.CRON_SECRET ?? ""}`,
              "user-agent": "cloudflare-cron/1.0",
            },
          }),
        );
        const body = (await response.text()).slice(0, 300);
        console.log(
          JSON.stringify({
            event: "cron.finished",
            cron: controller.cron,
            path,
            status: response.status,
            elapsed_ms: Date.now() - startedAt,
            body,
          }),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "cron.failed",
            cron: controller.cron,
            path,
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    })();
    ctx.waitUntil(run);
    // New container image since the last visit? Start each instance once, so
    // no visitor's render waits for it to be fetched (workers/render).
    if (controller.cron === WARM_CRON)
      ctx.waitUntil(
        warmContainers(env, origin).then(
          (started) => {
            if (started)
              console.log(
                JSON.stringify({ event: "containers.warmed", started }),
              );
          },
          (error: unknown) =>
            console.error(
              JSON.stringify({
                event: "containers.warm_failed",
                error: error instanceof Error ? error.message : "unknown",
              }),
            ),
        ),
      );
    await run;
  },
};

export default worker;
