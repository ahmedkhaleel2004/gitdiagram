import "server-only";

import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

import type { FilmImage } from "./director";

// The pictures a README shows (a logo, a screenshot of the product) make a
// film look made for that project. They are untrusted: only https addresses
// on public hosts are fetched, every connection (each redirect hop included)
// goes only to addresses checked public when it is made, and only still PNG,
// JPEG and WebP files within size limits whose structure holds together are
// kept, their type read from the bytes themselves. Animations are left out:
// an MP4 render seeks frame by frame, and a GIF would play on its own clock.

const MAX_PICTURES = 3;
const MAX_CANDIDATES = 8;
// Pictures worth showing sit near the top; the rest of a long README is not read.
const SCAN_CHARS = 100_000;
// Within what both model APIs accept, and light enough for a phone's stage.
const MAX_BYTES = 3 * 2 ** 20;
const MAX_SIDE = 4_000;
const FETCH_MS = 5_000;
const LOOKUP_MS = 3_000;
// The whole optional enrichment, so reading the repository never waits on it.
const PICTURES_MS = 8_000;

// Badges, sponsor logos, avatars and buttons say nothing about the project
// itself. Hosts match whole labels (x.com, not dropbox.com); words match whole
// words (a badge, not deployment-architecture.png).
const NOISE_HOSTS = [
  "shields.io",
  "badgen.net",
  "badge.fury.io",
  "travis-ci.org",
  "travis-ci.com",
  "codecov.io",
  "coveralls.io",
  "circleci.com",
  "appveyor.com",
  "opencollective.com",
  "gitpod.io",
  "deepwiki.com",
  "star-history.com",
  "contrib.rocks",
  "buymeacoffee.com",
  "ko-fi.com",
  "patreon.com",
  "discord.com",
  "discordapp.com",
  "twitter.com",
  "x.com",
  "avatars.githubusercontent.com",
  "herokucdn.com",
];
const NOISE_PATH =
  /(?:^|\/)workflows\/|(?:^|[^a-z])(?:badges?|sponsors?|avatars?)(?:[^a-z]|$)|(?:^|\/)button(?:\.svg)?$|deploy[-_]?(?:to[-_]?\w+[-_]?)?button/i;
const NOISE_ALT =
  /\b(?:badges?|sponsors?|sponsored|avatars?|discord|twitter|star history|deploy to|buy me a coffee|ko-?fi|patreon|open ?collective)\b/i;

function isNoise(url: URL, alt: string): boolean {
  const host = url.hostname.toLowerCase();
  // A repository's own files are judged by their path inside it, so a
  // repository named "avatar-kit" keeps its pictures.
  const path =
    host === "raw.githubusercontent.com"
      ? url.pathname.split("/").slice(4).join("/")
      : url.pathname;
  return (
    NOISE_HOSTS.some((noise) => host === noise || host.endsWith(`.${noise}`)) ||
    NOISE_PATH.test(path) ||
    NOISE_ALT.test(alt)
  );
}

export interface ReadmePicture {
  url: string;
  alt: string;
}

/**
 * Picture addresses in README order, resolved against the repository: at most
 * `limit`, found in the first SCAN_CHARS characters. Every quantifier is
 * bounded, so no README can make the scan slow.
 */
export function readmePictures(params: {
  readme: string;
  owner: string;
  repo: string;
  branch: string;
  limit?: number;
}): ReadmePicture[] {
  const { owner, repo, branch, limit = MAX_CANDIDATES } = params;
  const readme = params.readme.slice(0, SCAN_CHARS);
  const found: ReadmePicture[] = [];
  const seen = new Set<string>();
  const pattern =
    /!\[([^[\]]{0,300})\]\(\s{0,20}<?([^()\s>]{1,2000})>?(?:\s{1,20}"[^"]{0,300}")?\s{0,20}\)|<img\b[^<>]{0,2000}>/gi;
  for (const match of readme.matchAll(pattern)) {
    let url = match[2];
    let alt = match[1] ?? "";
    if (!url) {
      const tag = match[0];
      url = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    }
    const resolved = url && resolve(url, owner, repo, branch);
    if (!resolved || isNoise(resolved, alt)) continue;
    const address = resolved.toString();
    if (seen.has(address)) continue;
    seen.add(address);
    found.push({ url: address, alt: alt.slice(0, 120) });
    if (found.length >= limit) break;
  }
  return found;
}

function resolve(
  raw: string,
  owner: string,
  repo: string,
  branch: string,
): URL | null {
  let url: URL;
  try {
    // GitHub reads "/docs/logo.png" from the repository's root, not the host's.
    const relative = raw.startsWith("/") && !raw.startsWith("//");
    url = new URL(
      relative ? `.${raw}` : raw,
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
  return isPublicHttps(url) ? url : null;
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

// Every IANA special-purpose range that is not the public internet (RFC 6890
// and its updates). IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are checked
// against the IPv4 rules by BlockList itself.
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (carrier-grade NAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.31.196.0", 24], // AS112
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["192.175.48.0", 24], // AS112
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
] as const)
  PRIVATE.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible (::a.b.c.d)
  ["64:ff9b::", 96], // NAT64: may reach any IPv4 address
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: may reach any IPv4 address
  ["3fff::", 20], // documentation
  ["5f00::", 16], // segment routing
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local
  ["ff00::", 8], // multicast
] as const)
  PRIVATE.addSubnet(network, prefix, "ipv6");

/** Whether an address is one the public internet routes (not loopback, private, link-local, …). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  return !PRIVATE.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** A promise that rejects once the signal aborts. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * The name's addresses, used for the connection itself, only when every one
 * is public: a name that resolves inward (or changes its answer between a
 * check and the connection) never gets a socket. A slow resolver is given up
 * on after LOOKUP_MS.
 */
export function publicLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
): void {
  const refuse = (message: string) =>
    callback(Object.assign(new Error(message), { code: "EPICTURE" }), []);
  abortable(lookup(hostname, { all: true }), AbortSignal.timeout(LOOKUP_MS))
    .then((found) => {
      const family =
        options.family === "IPv4"
          ? 4
          : options.family === "IPv6"
            ? 6
            : options.family;
      const addresses = found.filter(
        (entry) => !family || entry.family === family,
      );
      if (!addresses.length) return refuse(`${hostname} has no address.`);
      if (!addresses.every(({ address }) => isPublicAddress(address)))
        return refuse(`${hostname} resolves to a private address.`);
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    })
    .catch((error: unknown) =>
      refuse(error instanceof Error ? error.message : "lookup failed"),
    );
}

/** One GET, connected only through publicLookup, with TLS checked as usual. */
function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return abortable(
    new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          headers: { accept: "image/*" },
          lookup: publicLookup,
          signal,
        },
        resolve,
      );
      req.on("error", reject);
      req.end();
    }),
    signal,
  );
}

/** The picture's bytes, or null when anything about it is off. Never throws. */
export async function fetchPicture(
  picture: ReadmePicture,
  signal?: AbortSignal,
): Promise<{ picture: ReadmePicture; bytes: Buffer } | null> {
  const timeout = AbortSignal.timeout(FETCH_MS);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: IncomingMessage | null = null;
  try {
    // Redirects are followed by hand, so every hop is checked like the first.
    let url = new URL(picture.url);
    for (let hop = 0; ; hop++) {
      response = await get(url, abort);
      const location = response.headers.location;
      const status = response.statusCode ?? 0;
      if (status < 300 || status >= 400 || !location) break;
      response.destroy();
      response = null;
      url = new URL(location, url);
      if (hop >= 3 || !isPublicHttps(url)) return null;
    }
    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) return null;
    if (Number(response.headers["content-length"]) > MAX_BYTES) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of abortableStream(response, abort)) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) return null;
      chunks.push(chunk);
    }
    return { picture, bytes: Buffer.concat(chunks) };
  } catch {
    return null;
  } finally {
    response?.destroy();
  }
}

/** The response's chunks, ending with an error once the signal aborts. */
async function* abortableStream(
  response: IncomingMessage,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  const chunks = response[Symbol.asyncIterator]();
  while (true) {
    const next = await abortable(chunks.next(), signal);
    if (next.done) return;
    yield next.value as Buffer;
  }
}

export type PictureType = FilmImage["mediaType"];

/**
 * The type and size of a still picture, read from its header: PNG (not
 * animated), JPEG or WebP (not animated). Null for anything else. See
 * isWholePicture for the structure check.
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
      if (isJpegFrame(marker))
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

/** Start-of-frame markers (SOF0–SOF15, less DHT, JPG and DAC). */
const isJpegFrame = (marker: number) =>
  marker >= 0xc0 &&
  marker <= 0xcf &&
  marker !== 0xc4 &&
  marker !== 0xc8 &&
  marker !== 0xcc;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The CRC-32 PNG stores after each chunk. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Whether a probed picture's structure holds together beyond its header, so
 * a truncated or made-up file is never sent to a model or stored: every PNG
 * chunk in bounds, the header's checksum right, image data before the end
 * chunk; a JPEG frame, scan and end marker; a WebP whose RIFF size is the
 * file's and whose first chunk fits in it. Decoding is left to the browser.
 */
export function isWholePicture(bytes: Uint8Array, type: PictureType): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png") {
    let at = 8;
    let data = false;
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at);
      const end = at + 12 + length;
      if (end > bytes.length) return false;
      const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (at === 8) {
        const crc = crc32(bytes.subarray(at + 4, at + 8 + length));
        if (kind !== "IHDR" || length !== 13) return false;
        if (crc !== view.getUint32(at + 8 + length)) return false;
      }
      if (kind === "IDAT") data = length > 0 || data;
      if (kind === "IEND") return data;
      at = end;
    }
    return false;
  }
  if (type === "image/jpeg") {
    let frame = false;
    for (let at = 2; at + 4 <= bytes.length;) {
      if (bytes[at] !== 0xff) return false;
      const marker = bytes[at + 1]!;
      if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) {
        at += marker === 0xff ? 1 : 2;
        continue;
      }
      const length = view.getUint16(at + 2);
      if (length < 2 || at + 2 + length > bytes.length) return false;
      if (isJpegFrame(marker)) frame = view.getUint16(at + 7) > 0;
      if (marker === 0xda) {
        // Entropy-coded data follows the scan header; the file ends at EOI.
        if (!frame) return false;
        for (let end = bytes.length - 2; end >= at + 2 + length; end--)
          if (bytes[end] === 0xff && bytes[end + 1] === 0xd9) return true;
        return false;
      }
      at += 2 + length;
    }
    return false;
  }
  // WebP: the RIFF size covers the rest of the file (plus an odd byte's pad).
  const riff = view.getUint32(4, true) + 8;
  if (riff !== bytes.length && riff + 1 !== bytes.length) return false;
  const first = view.getUint32(16, true);
  if (20 + first > riff) return false;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8 ")
    return bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a;
  if (chunk === "VP8L") return bytes[20] === 0x2f;
  return chunk === "VP8X";
}

export interface StoredPicture extends FilmImage {
  alt: string;
  /** The picture's bytes, as stored with the film. */
  bytes: Buffer;
}

/**
 * Up to three of the README's still pictures, in README order. Best effort:
 * a picture that fails is skipped, this never throws, and it gives up (with
 * none) after PICTURES_MS or when `signal` aborts, never waiting on a fetch
 * or a name lookup still running.
 */
export async function readReadmeImages(params: {
  readme: string;
  owner: string;
  repo: string;
  branch: string;
  signal?: AbortSignal;
}): Promise<StoredPicture[]> {
  const deadline = AbortSignal.timeout(PICTURES_MS);
  const signal = params.signal
    ? AbortSignal.any([params.signal, deadline])
    : deadline;
  // Each fetch settles as soon as the signal aborts.
  const fetched = await Promise.all(
    readmePictures(params).map((picture) => fetchPicture(picture, signal)),
  );
  const kept: StoredPicture[] = [];
  for (const item of fetched) {
    if (!item || kept.length >= MAX_PICTURES) continue;
    const probe = probePicture(item.bytes);
    if (!probe || !isWholePicture(item.bytes, probe.type)) continue;
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
