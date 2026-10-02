import { Container, getContainer } from "@cloudflare/containers";
import {
  containerPath,
  GENERATE_PATH,
  instanceName,
  isSignedSegmentJob,
  parseSegmentJob,
  SEGMENT_BUSY_HEADER,
  SEGMENT_PATH,
  segmentInstances,
} from "./router";

/**
 * What the container routes need from the Worker's environment. Every string
 * binding (vars and secrets) is handed to the containers as their process
 * environment, so the Next.js server inside reads the same settings as the
 * Worker: R2, Redis, CACHE_KEY_SECRET and so on.
 */
export interface RenderEnv {
  /** The render pool: MP4s, their segments and posters. */
  RENDER: DurableObjectNamespace<RenderContainer>;
  /**
   * A small instance for video generation, which only needs ffmpeg for a
   * moment (to encode the narration) but stays open for minutes. Unbound,
   * generation runs on the first render instance.
   */
  GENERATE?: DurableObjectNamespace<GenerateContainer>;
  /** Signs segment jobs; the router checks them before waking a container. */
  CACHE_KEY_SECRET: string;
  /**
   * The Worker's public origin, if it should not be taken from the request
   * that starts a container (see `SiteContainer.fetch`).
   */
  RENDER_PUBLIC_ORIGIN?: string;
  /** Container instances a render spreads over (default 5). */
  RENDER_POOL_SIZE?: string;
  /** Chromium renders one instance runs at once (default 2). */
  RENDER_SEGMENT_CONCURRENCY?: string;
  /** How long an idle instance stays awake, e.g. "30s" (the default). */
  RENDER_SLEEP_AFTER?: string;
}

const PORT = 3000;

/** Settings that only make sense on Vercel or on the Worker itself. */
const NOT_FOR_THE_CONTAINER =
  /^(VERCEL($|_)|TURBO_|NX_|RENDER_|PORT$|HOSTNAME$)/;

const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const poolSize = (env: RenderEnv) => positive(env.RENDER_POOL_SIZE, 5);
const perInstance = (env: RenderEnv) =>
  positive(env.RENDER_SEGMENT_CONCURRENCY, 2);

/**
 * A container's process environment: the Worker's string bindings, plus where
 * the Worker is. `origin` is the Worker's public origin; the container tells
 * it to refresh cached pages after a new video (REVALIDATE_ORIGIN) and, with
 * `spread`, posts segment jobs back through it so they reach the whole pool
 * (VIDEO_SEGMENT_ORIGIN) instead of staying on the instance that asked.
 */
export function containerEnv(
  env: RenderEnv,
  { origin, spread }: { origin: string; spread: boolean },
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(env))
    if (typeof value === "string" && !NOT_FOR_THE_CONTAINER.test(name))
      vars[name] = value;
  vars.VIDEO_SEGMENT_CONCURRENCY = String(perInstance(env));
  vars.REVALIDATE_ORIGIN = origin;
  if (spread) vars.VIDEO_SEGMENT_ORIGIN = origin;
  return vars;
}

/**
 * The site's Next.js server (the repo's Dockerfile) in a container. It
 * starts on the first request, stays awake while any request is in flight
 * (a render streams for minutes), and is told to stop `sleepAfter` after the
 * last one, so an idle site pays nothing. The server finishes work that
 * outlives its request (a render whose viewer left) before it exits
 * (src/server/drain.ts).
 */
abstract class SiteContainer extends Container<RenderEnv> {
  override defaultPort = PORT;
  override sleepAfter: string;
  // The readiness probe: any answer from the Next.js server will do.
  override pingEndpoint = "localhost/api/video/render/segment";

  /** Whether this container's segment jobs go back through the Worker. */
  protected abstract readonly spread: boolean;

  constructor(ctx: DurableObjectState<object>, env: RenderEnv) {
    super(ctx, env);
    this.sleepAfter = env.RENDER_SLEEP_AFTER?.trim() || "30s";
  }

  /**
   * The first request starts the container, and names the Worker's public
   * origin: the host the request came in on (workers.dev before the domain
   * moves, gitdiagram.com after), unless RENDER_PUBLIC_ORIGIN says otherwise.
   */
  override fetch(request: Request): Promise<Response> {
    if (!this.ctx.container?.running) {
      const origin =
        this.env.RENDER_PUBLIC_ORIGIN?.trim() ||
        new URL(request.url).origin.replace(/^http:/, "https:");
      this.envVars = containerEnv(this.env, { origin, spread: this.spread });
    }
    return super.fetch(request);
  }

  override onStop({ exitCode, reason }: { exitCode: number; reason: string }) {
    console.log(
      JSON.stringify({
        event: "container.stopped",
        container: this.constructor.name,
        exitCode,
        reason,
      }),
    );
  }

  override onError(error: unknown) {
    console.error(
      JSON.stringify({
        event: "container.error",
        container: this.constructor.name,
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      }),
    );
    throw error;
  }
}

/** One instance of the render pool: Chromium and ffmpeg at full size. */
export class RenderContainer extends SiteContainer {
  protected readonly spread = poolSize(this.env) > 1;
}

/**
 * The instance that makes videos: model calls and one short ffmpeg run, so
 * it is small. Its poster is a segment job, which goes to the render pool.
 */
export class GenerateContainer extends SiteContainer {
  protected readonly spread = true;
}

const json = (body: unknown, status: number, headers?: HeadersInit) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });

const instance = (env: RenderEnv, index: number) =>
  getContainer(env.RENDER, instanceName(index));

/** The response with a header naming the instance that answered (for logs and tests). */
function from(response: Response, index: number): Response {
  const named = new Response(response.body, response);
  named.headers.set("X-Render-Instance", String(index));
  return named;
}

/**
 * Send a segment job to an instance with room. The signature is checked
 * here, so a stranger's request never wakes a container; the container
 * checks it again. Busy instances are skipped; when all are busy the caller
 * gets the busy answer and retries, as it does on any platform.
 */
async function forwardSegment(
  request: Request,
  env: RenderEnv,
): Promise<Response> {
  if (request.method !== "POST")
    return json({ ok: false, error: "Method not allowed." }, 405);
  const body = await request.text();
  const job = body.length <= 65_536 ? parseSegmentJob(body) : null;
  if (
    !job ||
    !(await isSignedSegmentJob(
      job,
      request.headers.get("X-Video-Segment") ?? "",
      // The site trims its settings (readRequiredEnv); so must this.
      env.CACHE_KEY_SECRET.trim(),
    ))
  )
    return json({ ok: false, error: "Forbidden." }, 403);
  // What the last instance tried said, if none took the job.
  let refused: Response | null = null;
  for (const index of segmentInstances(
    job.from,
    poolSize(env),
    perInstance(env),
  )) {
    let response: Response;
    try {
      response = await instance(env, index).fetch(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body,
          signal: request.signal,
        }),
      );
    } catch (error) {
      if (request.signal.aborted) throw error;
      response = json(
        { ok: false, error: "Render instance unreachable." },
        502,
      );
    }
    // Busy (the route's own 503), or not serving at all: starting, stopping
    // for a deploy, or out of instances. Either way the next one may take it.
    // The route reports a failed render inside a 200 stream, so a 5xx here
    // never means "this job cannot be rendered".
    if (response.status < 500) return from(response, index);
    await refused?.body?.cancel();
    refused = from(response, index);
  }
  return (
    refused ??
    json({ ok: false, error: "No render instance." }, 503, {
      "Retry-After": "1",
      [SEGMENT_BUSY_HEADER]: "1",
    })
  );
}

/**
 * Hand a request for one of the container routes (see `isContainerPath`) to
 * a container. Segments spread over the render pool, the render itself runs
 * on the pool's first instance, and video generation on its own small one.
 */
export async function forwardToRender(
  request: Request,
  env: RenderEnv,
): Promise<Response> {
  const path = containerPath(new URL(request.url).pathname);
  if (path === SEGMENT_PATH) return forwardSegment(request, env);
  if (path === GENERATE_PATH && env.GENERATE)
    return getContainer(env.GENERATE, "generate").fetch(request);
  return from(await instance(env, 0).fetch(request), 0);
}
