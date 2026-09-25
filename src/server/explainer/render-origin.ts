import "server-only";

// An MP4 render calls back into the site: the render route posts segments to
// the segment route, Chromium loads the stage, and the soundtrack fetches its
// effect sounds. Every one of those calls must reach this same release, and
// must reach it at an address the server can call itself on.

/**
 * The origin the server calls itself on. On Vercel that is the public origin
 * of the request. A standalone container (the Railway recipe) listens on
 * 0.0.0.0, which Next puts into request.url and recent Chromium refuses to
 * load, so there it is loopback on the server's own port.
 * VIDEO_INTERNAL_ORIGIN overrides both.
 */
export function internalOrigin(request: Request): string {
  const configured = process.env.VIDEO_INTERNAL_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  const port = process.env.PORT?.trim();
  if (process.env.NODE_ENV === "production" && !process.env.VERCEL && port)
    return `http://127.0.0.1:${port}`;
  return new URL(request.url).origin;
}

/**
 * The running deployment, so a render that spans a deploy keeps every call on
 * the release that started it (Vercel Skew Protection routes on it). Null off
 * Vercel, where there is only one release.
 */
function deploymentId(): string | null {
  return process.env.VERCEL_DEPLOYMENT_ID?.trim() || null;
}

/** Headers that route a request to the running deployment. */
export function deploymentHeaders(): Record<string, string> {
  const id = deploymentId();
  return id ? { "x-deployment-id": id } : {};
}

/** `url` pinned to the running deployment with Vercel's `dpl` parameter. */
export function pinToDeployment(url: string): string {
  const id = deploymentId();
  if (!id) return url;
  const pinned = new URL(url);
  pinned.searchParams.set("dpl", id);
  return pinned.toString();
}
