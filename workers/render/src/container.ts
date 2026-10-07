import { Container, getContainer } from "@cloudflare/containers";
import {
  containerPath,
  GENERATE_PATH,
  instanceName,
  isSignedSegmentJob,
  parseSegmentJob,
  renderInstance,
  SEGMENT_BUSY_HEADER,
  SEGMENT_PATH,
  SEGMENT_WAITED_HEADER,
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
  /**
   * More instances, started only while every one of the pool's is busy
   * (several renders at once); default 0.
   */
  RENDER_POOL_OVERFLOW?: string;
  /** Chromium renders one instance runs at once (default 2). */
  RENDER_SEGMENT_CONCURRENCY?: string;
  /** How long an idle instance stays awake, e.g. "30s" (the default). */
  RENDER_SLEEP_AFTER?: string;
  /**
   * "1" keeps the pool (not its overflow) and the generation instance awake
   * for good: the cron touches each before `RENDER_SLEEP_AFTER` runs out
   * (see `keepContainersAwake`). Memory bills for every second of it.
   */
  RENDER_KEEP_AWAKE?: string;
  /**
   * The tag of the image the containers run, set by the deploy
   * (scripts/cf-container-image.mjs). When it changes, each instance is
   * started once ahead of visitors (see `warmContainers`).
   */
  RENDER_IMAGE?: string;
}

const PORT = 3000;

/** Where each instance remembers the image it was last warmed on. */
const WARMED_KEY = "warmed";
/** Visits (five minutes apart, from the cron) on which a new image is started. */
const WARM_TIMES = 3;

/** Settings that only make sense on Vercel or on the Worker itself. */
const NOT_FOR_THE_CONTAINER =
  /^(VERCEL($|_)|TURBO_|NX_|RENDER_|PORT$|HOSTNAME$)/;

const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const poolSize = (env: RenderEnv) => positive(env.RENDER_POOL_SIZE, 5);
export const overflowSize = (env: RenderEnv) =>
  Math.max(0, Number.parseInt(env.RENDER_POOL_OVERFLOW ?? "", 10) || 0);
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

  /**
   * Start the container if this is a new image it has not been started on
   * often enough yet. The first start after a deploy has to fetch the image,
   * which made the first render after one take about twice as long; started
   * here instead, it sleeps again after `sleepAfter`. Done on a few visits
   * in a row, because the first may come before the rollout has reached
   * this instance, and would only start the old image.
   */
  async warm(image: string, origin: string): Promise<boolean> {
    const done = await this.ctx.storage.get<{ image: string; times: number }>(
      WARMED_KEY,
    );
    const times = done?.image === image ? done.times : 0;
    if (times >= WARM_TIMES) return false;
    await this.ctx.storage.put(WARMED_KEY, { image, times: times + 1 });
    // Any answer will do: the readiness probe's own path (a GET is a 405).
    const response = await this.fetch(
      new Request(`${origin}${SEGMENT_PATH}`, { method: "GET" }),
    );
    await response.body?.cancel();
    console.log(
      JSON.stringify({
        event: "container.warmed",
        container: this.constructor.name,
        image,
        time: times + 1,
        status: response.status,
      }),
    );
    return true;
  }

  /**
   * A request that does no work: it starts a sleeping container and gives an
   * awake one another `sleepAfter` before it is told to stop.
   */
  async touch(origin: string): Promise<number> {
    // Any answer will do: the readiness probe's own path (a GET is a 405).
    const response = await this.fetch(
      new Request(`${origin}${SEGMENT_PATH}`, { method: "GET" }),
    );
    await response.body?.cancel();
    return response.status;
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
  // A job the whole pool has already turned away may start an overflow
  // instance; on its first try it only looks for room in the pool.
  const waited = Number(request.headers.get(SEGMENT_WAITED_HEADER)) > 0;
  // What the last instance tried said, if none took the job.
  let refused: Response | null = null;
  for (const index of segmentInstances(
    job.from,
    poolSize(env),
    perInstance(env),
    waited ? overflowSize(env) : 0,
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
 * After a deploy that changed the containers' image, start every instance
 * once (the overflow ones too: a burst right after a deploy otherwise waits
 * for each of them to fetch it) so no visitor's render waits for the image.
 * Called by the Worker's five-minute cron; an instance already warmed on
 * this image answers at once without starting anything.
 */
export async function warmContainers(
  env: RenderEnv,
  origin: string,
): Promise<number> {
  const image = env.RENDER_IMAGE?.trim();
  if (!image) return 0;
  const stubs = [
    ...Array.from({ length: poolSize(env) + overflowSize(env) }, (_, index) =>
      instance(env, index),
    ),
    ...(env.GENERATE ? [getContainer(env.GENERATE, "generate")] : []),
  ];
  const started = await Promise.all(
    stubs.map((stub) => stub.warm(image, origin).catch(() => false)),
  );
  return started.filter(Boolean).length;
}

/**
 * With RENDER_KEEP_AWAKE, touch the pool's instances and the generation one
 * so none is asleep when a visitor's render or video arrives (a start costs
 * a render 4 to 5 s). Called by the Worker's five-minute cron, so
 * `RENDER_SLEEP_AFTER` must be longer than that. The overflow instances are
 * left to sleep: they only run while the whole pool is busy.
 */
export async function keepContainersAwake(
  env: RenderEnv,
  origin: string,
): Promise<number> {
  if (env.RENDER_KEEP_AWAKE?.trim() !== "1") return 0;
  const stubs = [
    ...Array.from({ length: poolSize(env) }, (_, index) =>
      instance(env, index),
    ),
    ...(env.GENERATE ? [getContainer(env.GENERATE, "generate")] : []),
  ];
  const touched = await Promise.all(
    stubs.map((stub) =>
      stub.touch(origin).then(
        () => true,
        () => false,
      ),
    ),
  );
  return touched.filter(Boolean).length;
}

/**
 * Hand a request for one of the container routes (see `isContainerPath`) to
 * a container. Segments spread over the render pool, the render itself runs
 * on one of the pool's instances (the same one for the same film), and video
 * generation on its own instance.
 */
export async function forwardToRender(
  request: Request,
  env: RenderEnv,
): Promise<Response> {
  const path = containerPath(new URL(request.url).pathname);
  if (path === SEGMENT_PATH) return forwardSegment(request, env);
  if (path === GENERATE_PATH && env.GENERATE)
    return getContainer(env.GENERATE, "generate").fetch(request);
  const body = await request.text();
  const index = renderInstance(body, poolSize(env));
  return from(
    await instance(env, index).fetch(new Request(request, { body })),
    index,
  );
}
