import "server-only";

// An MP4 render calls back into the site: the render route posts segments to
// the segment route, Chromium loads the stage, and the soundtrack fetches its
// effect sounds. Every one of those calls must reach this same release, and
// must reach it at an address the server can call itself on.

/**
 * The origin the server calls itself on. A render container listens on
 * 0.0.0.0, which Next puts into request.url and recent Chromium refuses to
 * load, so there it is loopback on the server's own port; in development it
 * is the request's own origin. VIDEO_INTERNAL_ORIGIN overrides both.
 */
export function internalOrigin(request: Request): string {
  const configured = process.env.VIDEO_INTERNAL_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  const port = process.env.PORT?.trim();
  if (process.env.NODE_ENV === "production" && port)
    return `http://127.0.0.1:${port}`;
  return new URL(request.url).origin;
}

/**
 * Where segment jobs are posted. Normally the server itself. When render
 * instances sit behind a router that spreads segments over several of them
 * (Cloudflare Containers behind the site's Worker), VIDEO_SEGMENT_ORIGIN
 * names that router, while the stage and effect sounds still load from this
 * instance.
 */
export function segmentOrigin(request: Request): string {
  const configured = process.env.VIDEO_SEGMENT_ORIGIN?.trim();
  return configured ? new URL(configured).origin : internalOrigin(request);
}
