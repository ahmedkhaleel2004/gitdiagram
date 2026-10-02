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
  edgeDecision,
  isContainerPath,
  isPlatformResponseHeader,
  platformHeaders,
  visitorCacheControl,
  type CloudflareGeo,
  type EdgeRateLimit,
} from "../src/lib/cloudflare-edge";

export { DOQueueHandler, DOShardedTagCache } from "../.open-next/worker.js";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

type RateLimits = { [Name in EdgeRateLimit]?: RateLimit };

interface Env extends RateLimits {
  WORKER_SELF_REFERENCE: Fetcher;
  /** The render Container (ffmpeg and Chromium), once it is bound. */
  RENDER?: {
    idFromName(name: string): unknown;
    get(id: unknown): Fetcher;
  };
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

const handler = openNext as {
  fetch(request: Request, env: Env, ctx: Context): Promise<Response>;
};

/**
 * The app's response as Vercel would have passed it on: without the cache
 * directives and headers meant for the platform, and with next.config.js's
 * site-wide headers on the answers OpenNext leaves them off (redirects, the
 * proxy's own answers). On the PostHog rewrite they replace PostHog's own.
 */
function visitorResponse(response: Response, pathname: string): Response {
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
  const replace = pathname.startsWith("/phx9a/");
  for (const [name, value] of Object.entries(
    siteHeaders as Record<string, string>,
  ))
    if (replace || !headers.has(name)) headers.set(name, value);
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
  if (url.hostname === "www.gitdiagram.com") {
    url.hostname = "gitdiagram.com";
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

const worker = {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    // The render Container streams its own answers; everything else gets the
    // headers a visitor would have seen on Vercel.
    if (env.RENDER && isContainerPath(url.pathname)) {
      const limited = await firewall(request, env, url.pathname);
      if (limited) return limited;
      return env.RENDER.get(env.RENDER.idFromName("render")).fetch(
        asVercelRequest(request),
      );
    }
    return visitorResponse(await respond(request, env, ctx, url), url.pathname);
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
