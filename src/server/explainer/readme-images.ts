import "server-only";

import type { FilmImage } from "./director";

// The pictures a README shows (a logo, a screenshot of the product) make a
// film look made for that project. They are untrusted: only https addresses
// on public hosts are fetched, sizes are capped, and every picture is decoded
// and re-encoded, so only plain pixels reach the model and the stage.

const MAX_PICTURES = 3;
const MAX_CANDIDATES = 8;
const MAX_BYTES = 8 * 2 ** 20;
const FETCH_MS = 5_000;

// Badges, sponsor logos and avatars say nothing about the project itself.
const NOISE =
  /shields\.io|badge|\/workflows\/|travis-ci|codecov|coveralls|circleci|appveyor|opencollective|sponsor|avatars?|gitpod|deepwiki|star-history|contrib\.rocks|buymeacoffee|ko-fi|patreon|discord|twitter|x\.com|vercel\.com\/button|deploy/i;

export interface ReadmePicture {
  url: string;
  alt: string;
}

/** Picture addresses in README order, resolved against the repository. */
export function readmePictures(params: {
  readme: string;
  owner: string;
  repo: string;
  branch: string;
}): ReadmePicture[] {
  const { readme, owner, repo, branch } = params;
  const found: ReadmePicture[] = [];
  const pattern =
    /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img\b[^>]*>/gi;
  for (const match of readme.matchAll(pattern)) {
    let url = match[2];
    let alt = match[1] ?? "";
    if (!url) {
      const tag = match[0];
      url = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    }
    if (!url || NOISE.test(url) || NOISE.test(alt)) continue;
    const resolved = resolve(url, owner, repo, branch);
    if (resolved && !found.some((p) => p.url === resolved))
      found.push({ url: resolved, alt: alt.slice(0, 120) });
  }
  return found;
}

function resolve(raw: string, owner: string, repo: string, branch: string) {
  let url: URL;
  try {
    url = new URL(
      raw,
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`,
    );
  } catch {
    return null;
  }
  // A picture linked through GitHub's page view: fetch the file itself.
  const blob = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname);
  if (url.hostname === "github.com" && blob)
    url = new URL(
      `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`,
    );
  return isPublicHttps(url) ? url.toString() : null;
}

/** https on a public host name: no IP literals, no local or internal hosts. */
function isPublicHttps(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    !/^[\d.]+$/.test(host) &&
    !host.includes(":") &&
    !host.startsWith("[") &&
    host !== "localhost" &&
    !host.endsWith(".local") &&
    !host.endsWith(".internal") &&
    host.includes(".")
  );
}

async function fetchPicture(
  picture: ReadmePicture,
  signal?: AbortSignal,
): Promise<{ picture: ReadmePicture; bytes: Buffer } | null> {
  try {
    const timeout = AbortSignal.timeout(FETCH_MS);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    // Redirects are followed by hand, so every hop is checked like the first.
    let url = new URL(picture.url);
    let response: Response | null = null;
    for (let hop = 0; hop <= 3; hop++) {
      response = await fetch(url, {
        signal: abort,
        redirect: "manual",
        headers: { accept: "image/*" },
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) break;
      await response.body?.cancel();
      url = new URL(location, url);
      if (!isPublicHttps(url)) return null;
      response = null;
    }
    if (!response?.ok || !response.body) return null;
    if (Number(response.headers.get("content-length")) > MAX_BYTES) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) return null;
      chunks.push(chunk);
    }
    return { picture, bytes: Buffer.concat(chunks) };
  } catch {
    return null;
  }
}

export interface StoredPicture extends FilmImage {
  alt: string;
  /** The re-encoded picture as stored with the film. */
  bytes: Buffer;
}

/**
 * Up to three of the README's pictures, in README order, re-encoded as WebP no
 * larger than 1600 × 1000. Best effort: a picture that fails is skipped, and
 * this never throws.
 */
export async function readReadmeImages(params: {
  readme: string;
  owner: string;
  repo: string;
  branch: string;
  signal?: AbortSignal;
}): Promise<StoredPicture[]> {
  // Loaded here, not at the top: if the native module ever fails to load, a
  // film is made without pictures instead of the whole route failing.
  const sharp = await import("sharp").then(
    (module) => module.default,
    (error: unknown) => {
      console.error(
        JSON.stringify({
          event: "video.pictures.unavailable",
          error:
            error instanceof Error ? error.message.slice(0, 200) : "unknown",
        }),
      );
      return null;
    },
  );
  if (!sharp) return [];
  const candidates = readmePictures(params).slice(0, MAX_CANDIDATES);
  const fetched = await Promise.all(
    candidates.map((picture) => fetchPicture(picture, params.signal)),
  );
  const kept: StoredPicture[] = [];
  for (const item of fetched) {
    if (!item || kept.length >= MAX_PICTURES) continue;
    try {
      // The first frame of an animation, re-encoded with no metadata kept.
      const image = sharp(item.bytes, {
        limitInputPixels: 40_000_000,
        animated: false,
      });
      const meta = await image.metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      // Too small to be more than an icon, or a thin strip.
      if (width < 240 || height < 120 || width / height > 5) continue;
      const { data, info } = await image
        .rotate()
        .resize({
          width: 1600,
          height: 1000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      kept.push({
        id: `img${kept.length + 1}`,
        mediaType: "image/webp",
        data: data.toString("base64"),
        width: info.width,
        height: info.height,
        alt: item.picture.alt,
        bytes: data,
      });
    } catch {
      continue;
    }
  }
  return kept;
}
