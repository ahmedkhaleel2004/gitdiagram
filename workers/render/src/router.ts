// Which requests go to the render containers, and to which one.
//
// MP4s, posters and narration need headless Chromium and ffmpeg, which cannot
// run in a Worker, so the site's Worker hands those routes to a small pool of
// containers that run the same Next.js build (the repo's Dockerfile). This
// file is the pure half (no bindings), so it is tested without a runtime.

/** The segment route: one ~5 s piece of a film, or a poster. Server to server only. */
export const SEGMENT_PATH = "/api/video/render/segment";

/** Video generation: ffmpeg encodes the narration. */
export const GENERATE_PATH = "/api/video/generate";

/**
 * Routes that spawn ffmpeg or Chromium and so must run in a container:
 * the MP4 render (ffmpeg mix and join), its segments (Chromium + ffmpeg) and
 * video generation.
 */
export const CONTAINER_PATHS: readonly string[] = [
  "/api/video/render",
  SEGMENT_PATH,
  GENERATE_PATH,
];

/** The container route a path names (with or without a trailing slash), if any. */
export function containerPath(pathname: string): string | null {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return CONTAINER_PATHS.includes(path) ? path : null;
}

export const isContainerPath = (pathname: string) =>
  containerPath(pathname) !== null;

/** The segment route's header on a 503 that means "this instance is busy, try another". */
export const SEGMENT_BUSY_HEADER = "X-Video-Segment-Busy";

/**
 * How many busy answers a segment job has had so far (the render that sends
 * it counts). The first time round a job only tries the pool's regular
 * instances; one that has already been turned away may also start an
 * overflow instance (see `segmentInstances`).
 */
export const SEGMENT_WAITED_HEADER = "X-Video-Segment-Waited";

/** Frames per segment (RENDER_FPS × 5 in src/server/explainer/ffmpeg.ts). */
const SEGMENT_FRAMES = 150;

/** The part of a segment job the router reads; the container validates all of it. */
export type SegmentJob = {
  username: string;
  repo: string;
  v: string;
  format: string;
  from: number;
  to: number;
  exp: number;
  edit?: unknown;
};

export function parseSegmentJob(body: string): SegmentJob | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const job = value as Record<string, unknown>;
  const text = (key: string) => typeof job[key] === "string";
  const whole = (key: string) => Number.isInteger(job[key]);
  if (!text("username") || !text("repo") || !text("v") || !text("format"))
    return null;
  if (!whole("from") || !whole("to") || !whole("exp")) return null;
  return job as unknown as SegmentJob;
}

const encoder = new TextEncoder();

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(data));
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * The signature the site puts on a segment job (`sign` in
 * src/server/explainer/segments.ts; keep the two in step). The router checks
 * it before waking a container, so only the site's own renders can start one
 * through the segment route.
 */
export async function segmentSignature(
  job: SegmentJob,
  cacheKeySecret: string,
): Promise<string> {
  const key = await hmac(
    encoder.encode(cacheKeySecret),
    "video-segment-key/v1",
  );
  const payload = JSON.stringify([
    job.username.toLowerCase(),
    job.repo.toLowerCase(),
    job.v,
    job.format,
    job.from,
    job.to,
    job.exp,
    ...(job.edit ? [job.edit] : []),
  ]);
  return hex(await hmac(key, payload));
}

export async function isSignedSegmentJob(
  job: SegmentJob,
  signature: string,
  cacheKeySecret: string,
  now = Date.now(),
): Promise<boolean> {
  if (job.exp < now || job.to <= job.from) return false;
  const expected = await segmentSignature(job, cacheKeySecret);
  if (signature.length !== expected.length) return false;
  let different = 0;
  for (let index = 0; index < expected.length; index++)
    different |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  return different === 0;
}

/**
 * The instances to try for a segment, in order. A render keeps a bounded
 * number of segments in flight and each instance renders a couple at once, so
 * neighbouring segments share an instance and the rest spread out: every
 * instance a render needs starts at the same moment instead of one after
 * another as each fills up. A busy instance answers 503 and the next in the
 * ring is tried. Posters (frame 0) land on the first instance.
 *
 * `overflow` instances (numbered after the pool's) come after every regular
 * one, in a ring of their own: they are only reached when the whole pool is
 * busy, which is how several renders at once get more Chromiums than one
 * render ever uses, while a lone render never wakes them.
 */
export function segmentInstances(
  from: number,
  poolSize: number,
  perInstance: number,
  overflow = 0,
): number[] {
  const size = Math.max(1, Math.floor(poolSize));
  const extra = Math.max(0, Math.floor(overflow));
  const slot = Math.floor(from / SEGMENT_FRAMES / Math.max(1, perInstance));
  const ring = (count: number) => ((slot % count) + count) % count;
  return [
    ...Array.from({ length: size }, (_, step) => (ring(size) + step) % size),
    ...Array.from(
      { length: extra },
      (_, step) => size + ((ring(extra) + step) % extra),
    ),
  ];
}

/**
 * The pool instance that runs a render (the soundtrack, the join, the
 * upload), chosen by what is rendered: several renders at once then share
 * neither one instance's processor nor its fate. `body` is the render
 * request's JSON; anything else lands on the first instance.
 */
export function renderInstance(body: string, poolSize: number): number {
  const size = Math.max(1, Math.floor(poolSize));
  let name: string;
  try {
    const { username, repo, format } = JSON.parse(body) as Record<
      string,
      unknown
    >;
    if (typeof username !== "string" || typeof repo !== "string") return 0;
    name = `${username}/${repo}:${String(format)}`.toLowerCase();
  } catch {
    return 0;
  }
  // FNV-1a: small, and even enough over a handful of instances.
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % size;
}

/** The name of a pool instance; the same name is always the same container. */
export const instanceName = (index: number) => `render-${index}`;
