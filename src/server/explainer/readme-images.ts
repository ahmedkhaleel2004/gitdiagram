import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { FilmImage } from "./director";

// The pictures a README shows (a logo, a screenshot of the product) make a
// film look made for that project. They are untrusted: only https addresses
// on public hosts are fetched (every redirect hop checked), and only still
// PNG, JPEG and WebP files within size limits are kept, their type read from
// the bytes themselves. Animations are left out: an MP4 render seeks frame by
// frame, and a GIF would play on its own clock.

const MAX_PICTURES = 3;
const MAX_CANDIDATES = 8;
// Within what both model APIs accept, and light enough for a phone's stage.
const MAX_BYTES = 3 * 2 ** 20;
const MAX_SIDE = 4_000;
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
  // "localhost." is localhost: compare names without the root dot.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
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
      // Checked by address too, so a public name pointing inward is refused.
      if (!(await resolvesPublic(url))) return null;
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

export type PictureType = FilmImage["mediaType"];

/** Whether an address is one the public internet routes (not loopback, private, link-local, …). */
export function isPublicAddress(address: string): boolean {
  const v4 =
    isIP(address) === 4 ? address : /^::ffff:([\d.]+)$/i.exec(address)?.[1];
  if (v4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return !(
    v6 === "::" ||
    v6 === "::1" ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith("ff")
  );
}

/** Every address the host name resolves to must be public. */
async function resolvesPublic(url: URL): Promise<boolean> {
  try {
    const addresses = await lookup(url.hostname, { all: true });
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => isPublicAddress(address))
    );
  } catch {
    return false;
  }
}

/**
 * The type and size of a still picture, read from its header: PNG (not
 * animated), JPEG or WebP (not animated). Null for anything else.
 */
export function probePicture(
  bytes: Uint8Array,
): { type: PictureType; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length < 30) return null;
  // PNG: the IHDR chunk comes first; an acTL chunk before the image data
  // makes it an animation.
  if (ascii(1, 3) === "PNG" && bytes[0] === 0x89) {
    for (let at = 8; at + 8 <= bytes.length;) {
      const length = view.getUint32(at);
      const kind = ascii(at + 4, 4);
      if (kind === "acTL") return null;
      if (kind === "IDAT") break;
      at += 12 + length;
    }
    return {
      type: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }
  // JPEG: the first start-of-frame marker holds the size.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 9 < bytes.length;) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame)
        return {
          type: "image/jpeg",
          height: view.getUint16(at + 5),
          width: view.getUint16(at + 7),
        };
      at += 2 + view.getUint16(at + 2);
    }
    return null;
  }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X, maybe animated).
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ")
      return {
        type: "image/webp",
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return {
        type: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X") {
      if (bytes[20]! & 0x02) return null;
      const u24 = (at: number) =>
        bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
      return { type: "image/webp", width: u24(24) + 1, height: u24(27) + 1 };
    }
  }
  return null;
}

export interface StoredPicture extends FilmImage {
  alt: string;
  /** The picture's bytes, as stored with the film. */
  bytes: Buffer;
}

/**
 * Up to three of the README's still pictures, in README order. Best effort:
 * a picture that fails is skipped, and this never throws.
 */
export async function readReadmeImages(params: {
  readme: string;
  owner: string;
  repo: string;
  branch: string;
  signal?: AbortSignal;
}): Promise<StoredPicture[]> {
  const candidates = readmePictures(params).slice(0, MAX_CANDIDATES);
  const fetched = await Promise.all(
    candidates.map((picture) => fetchPicture(picture, params.signal)),
  );
  const kept: StoredPicture[] = [];
  for (const item of fetched) {
    if (!item || kept.length >= MAX_PICTURES) continue;
    const probe = probePicture(item.bytes);
    if (!probe) continue;
    const { type, width, height } = probe;
    // Too small to be more than an icon, a thin strip, or too big to send.
    if (width < 240 || height < 120 || width / height > 5) continue;
    if (Math.max(width, height) > MAX_SIDE) continue;
    kept.push({
      id: `img${kept.length + 1}`,
      mediaType: type,
      data: item.bytes.toString("base64"),
      width,
      height,
      alt: item.picture.alt,
      bytes: item.bytes,
    });
  }
  return kept;
}
