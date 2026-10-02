// The site's entry on Cloudflare Workers. It wraps the worker OpenNext builds
// (`bun run cf:build` writes .open-next/worker.js) with what Vercel's platform
// did around the app: geolocation and client-address headers, cron, and the
// hand-off of ffmpeg/Chromium routes to the render Container.
//
// Not part of the Vercel build; wrangler bundles it (see wrangler.jsonc). The
// root tsconfig skips this folder: .open-next only exists after a build.

import openNext from "../.open-next/worker.js";
// next.config.js headers for every path (scripts/cf-asset-headers.mjs).
import siteHeaders from "../.open-next/site-headers.json";
import {
  CRON_ROUTES,
  containerRefusal,
  edgeDecision,
  isContainerPath,
  isPlatformResponseHeader,
  platformHeaders,
  visitorCacheControl,
  type CloudflareGeo,
  type EdgeRateLimit,
} from "../src/lib/cloudflare-edge";

import {
  forwardToRender,
  type RenderEnv,
} from "../workers/render/src/container";

export { DOQueueHandler, DOShardedTagCache } from "../.open-next/worker.js";
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
  CRON_SECRET?: string;
  SITE_ORIGIN?: string;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

// Node's fetch (what the app runs on at Vercel) names itself; a Worker's sends
// no User-Agent at all, and GitHub's API refuses such requests with a 403.
const platformFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (headers.has("user-agent")) return platformFetch(input, init);
  headers.set("user-agent", "node");
  return platformFetch(input, { ...init, headers });
}) as typeof fetch;

const SITE_HOSTNAME = "gitdiagram.com";

const handler = openNext as {
  fetch(request: Request, env: Env, ctx: Context): Promise<Response>;
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
  const decision = edgeDecision(pathname, request.headers.get("user-agent"));
  if (decision?.action === "deny")
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
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
  return (
    (await firewall(request, env, url.pathname)) ??
    handler.fetch(asVercelRequest(request), env, ctx)
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

const worker = {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    if (isContainerPath(url.pathname))
      return visitorResponse(await container(request, env, url), url, true);
    return visitorResponse(await respond(request, env, ctx, url), url);
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
    await run;
  },
};

export default worker;
