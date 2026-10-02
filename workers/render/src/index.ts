// A standalone Worker in front of the render containers, used to prove them
// without the site's own Worker. The site's Worker does the same two things:
// export RenderContainer, and send `isContainerPath` requests to
// `forwardToRender`.
import { getContainer } from "@cloudflare/containers";
import { forwardToRender, poolSize, type RenderEnv } from "./container";
import { instanceName, isContainerPath } from "./router";

export { GenerateContainer, RenderContainer } from "./container";

type Env = RenderEnv & { VIDEO_ADMIN_TOKEN?: string };

/**
 * Operator-only test hooks: `GET /__render/state` lists each instance's
 * state, `POST /__render/destroy?i=N` kills instance N at once (SIGKILL, as
 * an eviction would) and `POST /__render/stop?i=N` asks it to stop (SIGTERM,
 * as a deploy does).
 */
async function testHook(request: Request, env: Env): Promise<Response> {
  const token = env.VIDEO_ADMIN_TOKEN?.trim();
  if (!token || request.headers.get("Authorization") !== `Bearer ${token}`)
    return new Response("Forbidden.", { status: 403 });
  const url = new URL(request.url);
  const stub = (index: number) => getContainer(env.RENDER, instanceName(index));
  if (url.pathname === "/__render/state") {
    const states = await Promise.all(
      Array.from({ length: poolSize(env) }, async (_, index) => ({
        index,
        ...(await stub(index).getState()),
      })),
    );
    return Response.json(states);
  }
  const index = Number(url.searchParams.get("i") ?? "0");
  if (request.method === "POST" && url.pathname === "/__render/destroy") {
    await stub(index).destroy();
    return Response.json({ destroyed: index });
  }
  if (request.method === "POST" && url.pathname === "/__render/stop") {
    await stub(index).stop();
    return Response.json({ stopped: index });
  }
  return new Response("Not found.", { status: 404 });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (isContainerPath(pathname)) return forwardToRender(request, env);
    if (pathname.startsWith("/__render/")) return testHook(request, env);
    return new Response("Not found.", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
