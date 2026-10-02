// The staging Worker's entry (`bun scripts/cf-staging.ts deploy`): the site's
// own Worker, plus operator-only hooks that do to a container what the
// platform can do to it, so the video pipeline's failure paths can be tested
// away from the live site. Never deployed as `gitdiagram`.
//
//   GET  /__containers/state           every instance's state
//   POST /__containers/stop?c=render&i=0    SIGTERM (a deploy, a host drain)
//   POST /__containers/kill?c=render&i=0    SIGKILL (a crash, out of memory)
//   POST /__containers/kill?c=generate
//   POST /__cron?cron=*/15 * * * *     run a cron handler now

import { getContainer } from "@cloudflare/containers";
import { instanceName } from "../workers/render/src/router";
import {
  overflowSize,
  poolSize,
  type RenderEnv,
} from "../workers/render/src/container";
import site from "./worker";

// Everything the site's Worker exports besides its handlers: the Durable
// Object classes its bindings name.
export * from "./worker";

type Env = RenderEnv & { VIDEO_ADMIN_TOKEN?: string };
type Site = {
  fetch(request: Request, env: Env, ctx: unknown): Promise<Response>;
  scheduled(
    controller: { cron: string },
    env: Env,
    ctx: unknown,
  ): Promise<void>;
};
const worker = site as unknown as Site;

async function hook(request: Request, env: Env, ctx: unknown, url: URL) {
  const token = env.VIDEO_ADMIN_TOKEN?.trim();
  if (!token || request.headers.get("Authorization") !== `Bearer ${token}`)
    return new Response("Forbidden.", { status: 403 });
  const render = (index: number) =>
    getContainer(env.RENDER, instanceName(index));
  const generate = () => getContainer(env.GENERATE!, "generate");
  if (url.pathname === "/__containers/state") {
    const states = await Promise.all([
      ...Array.from(
        { length: poolSize(env) + overflowSize(env) },
        async (_, index) => ({
          container: `render-${index}`,
          ...(await render(index).getState()),
        }),
      ),
      generate()
        .getState()
        .then((state) => ({ container: "generate", ...state })),
    ]);
    return Response.json(states);
  }
  if (request.method !== "POST")
    return new Response("Method not allowed.", { status: 405 });
  if (url.pathname === "/__cron") {
    await worker.scheduled(
      { cron: url.searchParams.get("cron") ?? "" },
      env,
      ctx,
    );
    return Response.json({ ran: url.searchParams.get("cron") });
  }
  const stub =
    url.searchParams.get("c") === "generate"
      ? generate()
      : render(Number(url.searchParams.get("i") ?? "0"));
  if (url.pathname === "/__containers/kill") {
    await stub.destroy();
    return Response.json({ killed: true });
  }
  if (url.pathname === "/__containers/stop") {
    await stub.stop();
    return Response.json({ stopped: true });
  }
  return new Response("Not found.", { status: 404 });
}

const staging = {
  fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__c")) return hook(request, env, ctx, url);
    return worker.fetch(request, env, ctx);
  },
  scheduled: worker.scheduled,
};

export default staging;
