// The site's entry on Cloudflare Workers. It wraps the worker OpenNext builds
// (`bun run cf:build` writes .open-next/worker.js) with what Vercel's platform
// did around the app: geolocation and client-address headers, cron, and the
// hand-off of ffmpeg/Chromium routes to the render Container.
//
// Not part of the Vercel build; wrangler bundles it (see wrangler.jsonc). The
// root tsconfig skips this folder: .open-next only exists after a build.

import openNext from "../.open-next/worker.js";
import {
  CRON_ROUTES,
  isContainerPath,
  platformHeaders,
  type CloudflareGeo,
} from "../src/lib/cloudflare-edge";

export { DOQueueHandler, DOShardedTagCache } from "../.open-next/worker.js";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
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

const handler = openNext as {
  fetch(request: Request, env: Env, ctx: Context): Promise<Response>;
};

const worker = {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const cf = (request as Request & { cf?: CloudflareGeo }).cf;
    const forwarded = new Request(request, {
      headers: platformHeaders(request.headers, cf),
    });

    if (env.RENDER && isContainerPath(new URL(request.url).pathname)) {
      return env.RENDER.get(env.RENDER.idFromName("render")).fetch(forwarded);
    }

    return handler.fetch(forwarded, env, ctx);
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
