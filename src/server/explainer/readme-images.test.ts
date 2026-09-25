import { EventEmitter } from "node:events";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { crc32 as zlibCrc32 } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const net = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: net.lookup }));
vi.mock("node:https", () => ({ request: net.request }));

import {
  crc32,
  fetchPicture,
  isPublicAddress,
  isWholePicture,
  probePicture,
  publicLookup,
  readReadmeImages,
  readmePictures,
} from "./readme-images";

const pictures = (readme: string) =>
  readmePictures({ readme, owner: "acme", repo: "widget", branch: "HEAD" }).map(
    (picture) => picture.url,
  );

describe("README pictures", () => {
  it("finds markdown and HTML pictures in README order", () => {
    expect(
      pictures(
        '<p align="center"><img src="docs/logo.png" alt="Widget"></p>\n\n![Demo](https://example.com/demo.gif "demo")',
      ),
    ).toEqual([
      "https://raw.githubusercontent.com/acme/widget/HEAD/docs/logo.png",
      "https://example.com/demo.gif",
    ]);
  });

  it("skips badges, sponsors and avatars", () => {
    expect(
      pictures(
        '![CI](https://github.com/acme/widget/workflows/ci/badge.svg) ![npm](https://img.shields.io/npm/v/widget) <img src="https://opencollective.com/widget/sponsors/0/avatar.svg"> ![chat](https://example.com/chat.png "x") ![Discord](https://example.com/join.png) [![Deploy](https://vercel.com/button)](https://vercel.com/new) ![](https://x.com/logo.png)',
      ),
    ).toEqual(["https://example.com/chat.png"]);
  });

  it("matches noise by whole host and whole word", () => {
    expect(
      pictures(
        "![arch](docs/deployment-architecture.png) ![shot](https://dropbox.com/s/shot.png) ![inbox](https://inbox.com/a.png)",
      ),
    ).toEqual([
      "https://raw.githubusercontent.com/acme/widget/HEAD/docs/deployment-architecture.png",
      "https://dropbox.com/s/shot.png",
      "https://inbox.com/a.png",
    ]);
    // The repository's own name is not part of what is judged.
    expect(
      readmePictures({
        readme: "![logo](logo.png)",
        owner: "acme",
        repo: "avatar-kit",
        branch: "HEAD",
      }),
    ).toHaveLength(1);
  });

  it("reads a root-relative path from the repository's root", () => {
    expect(pictures("![logo](/docs/logo.png)")).toEqual([
      "https://raw.githubusercontent.com/acme/widget/HEAD/docs/logo.png",
    ]);
  });

  it("fetches files linked through GitHub's page view", () => {
    expect(
      pictures("![shot](https://github.com/acme/widget/blob/main/shot.png)"),
    ).toEqual(["https://raw.githubusercontent.com/acme/widget/main/shot.png"]);
  });

  it("only fetches https addresses on public host names", () => {
    expect(
      pictures(
        "![a](http://example.com/a.png) ![b](https://127.0.0.1/b.png) ![c](https://localhost/c.png) ![d](https://metadata.internal/d.png) ![e](https://[::1]/e.png)",
      ),
    ).toEqual([]);
  });

  it("stops at eight distinct pictures", () => {
    const readme = Array.from(
      { length: 20 },
      (_, i) => `![a](p${i % 12}.png)`,
    ).join(" ");
    expect(pictures(readme)).toHaveLength(8);
    expect(new Set(pictures(readme)).size).toBe(8);
  });

  it("reads a hostile README quickly", () => {
    for (const unit of [
      "<img",
      "<img a",
      "<img src=",
      "![",
      "![a](",
      "![a](b ",
      '![a](b "',
      "![a](" + "x".repeat(1_990),
    ]) {
      const readme = unit.repeat(Math.ceil(750_000 / unit.length));
      const started = performance.now();
      pictures(readme);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});

const u32 = (n: number) => [
  n >>> 24,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];

/** A PNG chunk with its real checksum. */
function chunk(kind: string, body: number[]) {
  const typed = [...[...kind].map((c) => c.charCodeAt(0)), ...body];
  return [...u32(body.length), ...typed, ...u32(zlibCrc32(Buffer.from(typed)))];
}

/** A whole PNG: signature, IHDR (and any chunks before the image data), IDAT, IEND. */
function png(width: number, height: number, extra: string[] = []) {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...extra.flatMap((kind) => chunk(kind, [0, 0, 0, 1, 0, 0, 0, 0])),
    ...chunk("IDAT", [0]),
    ...chunk("IEND", []),
  ]);
}

// SOI, an APP0 segment of 4 bytes, SOF0 (height 600, width 800), a scan
// header, a little entropy-coded data, then EOI.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 2, 88, 3, 32, 3, 1,
  0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 4, 0, 0, 0x12, 0x34, 0xff,
  0xd9,
]);

function webp(chunkName: string, body: number[]) {
  const bytes = new Uint8Array(40);
  const ascii = (text: string, at: number) =>
    bytes.set(
      [...text].map((c) => c.charCodeAt(0)),
      at,
    );
  ascii("RIFF", 0);
  new DataView(bytes.buffer).setUint32(4, 32, true);
  ascii("WEBP", 8);
  ascii(chunkName, 12);
  new DataView(bytes.buffer).setUint32(16, 20, true);
  bytes.set(body, 20);
  return bytes;
}

describe("reading a picture's header", () => {
  it("reads still PNG, JPEG and WebP sizes", () => {
    expect(probePicture(png(1280, 640))).toEqual({
      type: "image/png",
      width: 1280,
      height: 640,
    });
    expect(probePicture(JPEG)).toEqual({
      type: "image/jpeg",
      width: 800,
      height: 600,
    });
    // VP8X: flags, three reserved bytes, then width-1 and height-1 (24-bit).
    expect(
      probePicture(webp("VP8X", [0, 0, 0, 0, 0x1f, 3, 0, 0x57, 2, 0])),
    ).toEqual({
      type: "image/webp",
      width: 800,
      height: 600,
    });
    // VP8: frame tag and start code, then 14-bit width and height.
    expect(
      probePicture(webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 3, 0x58, 2])),
    ).toEqual({
      type: "image/webp",
      width: 800,
      height: 600,
    });
  });

  it("refuses animations and anything that is not a picture", () => {
    expect(probePicture(png(1280, 640, ["acTL"]))).toBeNull();
    expect(
      probePicture(webp("VP8X", [0x02, 0, 0, 0, 0x1f, 3, 0, 0x57, 2, 0])),
    ).toBeNull();
    const gif = new TextEncoder().encode("GIF89a".padEnd(40, "\0"));
    expect(probePicture(gif)).toBeNull();
    expect(
      probePicture(
        new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        ),
      ),
    ).toBeNull();
  });
});

describe("a picture's structure", () => {
  it("computes the checksum PNG uses", () => {
    const bytes = new TextEncoder().encode("IHDR and more");
    expect(crc32(bytes)).toBe(zlibCrc32(Buffer.from(bytes)));
  });

  it("accepts whole PNG, JPEG and WebP files", () => {
    expect(isWholePicture(png(640, 480), "image/png")).toBe(true);
    expect(isWholePicture(JPEG, "image/jpeg")).toBe(true);
    expect(
      isWholePicture(
        webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 3, 0x58, 2]),
        "image/webp",
      ),
    ).toBe(true);
  });

  it("refuses a header with nothing behind it", () => {
    // Thirty bytes that read as a 640 × 480 PNG.
    const stub = png(640, 480).subarray(0, 33);
    expect(probePicture(stub)).toMatchObject({ width: 640, height: 480 });
    expect(isWholePicture(stub, "image/png")).toBe(false);
    const whole = png(640, 480);
    // A broken header checksum, and a file cut before its end chunk.
    const corrupt = whole.slice();
    corrupt[29] = corrupt[29]! ^ 0xff;
    expect(isWholePicture(corrupt, "image/png")).toBe(false);
    expect(
      isWholePicture(whole.subarray(0, whole.length - 12), "image/png"),
    ).toBe(false);
    // No image data at all.
    const empty = new Uint8Array([
      ...whole.subarray(0, 33),
      ...chunk("IEND", []),
    ]);
    expect(isWholePicture(empty, "image/png")).toBe(false);
    // A JPEG without its scan or end marker.
    expect(isWholePicture(JPEG.subarray(0, 27), "image/jpeg")).toBe(false);
    expect(
      isWholePicture(JPEG.subarray(0, JPEG.length - 2), "image/jpeg"),
    ).toBe(false);
    // A WebP whose RIFF size is not the file's.
    const cut = webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 3, 0x58, 2]);
    expect(isWholePicture(cut.subarray(0, 36), "image/webp")).toBe(false);
  });
});

describe("public addresses", () => {
  it("refuses every special-purpose range, however it is written", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "198.18.0.1",
      "192.0.2.1",
      "240.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fd00::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::127.0.0.1",
      "64:ff9b::a00:1",
      "2002:a00:1::1",
      "2001:db8::1",
      "not an address",
    ])
      expect(isPublicAddress(address), address).toBe(false);
    for (const address of [
      "140.82.112.3",
      "185.199.108.133",
      "::ffff:140.82.112.3",
      "2606:50c0:8000::154",
    ])
      expect(isPublicAddress(address), address).toBe(true);
  });

  it("treats a trailing-dot local name as local", () => {
    expect(pictures("![a](https://localhost./a.png)")).toEqual([]);
  });
});

// A tiny fake network: names resolve through `dns`, and each address answers
// with `routes`, reached only through the lookup the request was given.
const dns = new Map<string, string[]>();
type Route = {
  status: number;
  headers?: Record<string, string>;
  body?: Buffer;
  hang?: boolean;
};
const routes = new Map<string, Route>();

beforeEach(() => {
  dns.clear();
  routes.clear();
  net.lookup.mockReset();
  net.request.mockReset();
  net.lookup.mockImplementation(async (host: string) =>
    (dns.get(host) ?? []).map((address) => ({
      address,
      family: isIP(address),
    })),
  );
  net.request.mockImplementation(
    (
      url: URL,
      options: {
        lookup: (
          host: string,
          options: object,
          callback: (error: Error | null) => void,
        ) => void;
      },
      respond: (response: unknown) => void,
    ) => {
      const req = Object.assign(new EventEmitter(), {
        end: () =>
          options.lookup(url.hostname, { all: true }, (error) => {
            if (error) return req.emit("error", error);
            const route = routes.get(url.toString());
            if (!route) return req.emit("error", new Error("refused"));
            if (route.hang) return;
            respond(
              Object.assign(Readable.from(route.body ? [route.body] : []), {
                statusCode: route.status,
                headers: route.headers ?? {},
              }),
            );
          }),
      });
      return req;
    },
  );
});

const PICTURE = { url: "https://img.example.com/a.png", alt: "" };

describe("fetching a picture", () => {
  it("fetches a picture from a public host", async () => {
    dns.set("img.example.com", ["93.184.215.14"]);
    routes.set(PICTURE.url, { status: 200, body: Buffer.from(png(640, 480)) });
    const fetched = await fetchPicture(PICTURE);
    expect(fetched?.bytes.length).toBe(png(640, 480).length);
  });

  it("never connects to a name that resolves inward, even partly", async () => {
    dns.set("img.example.com", ["93.184.215.14", "10.0.0.5"]);
    routes.set(PICTURE.url, { status: 200, body: Buffer.from("x") });
    expect(await fetchPicture(PICTURE)).toBeNull();
    const callback = vi.fn();
    publicLookup("img.example.com", { all: true }, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    expect(callback.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it("hands the checked addresses to the connection", async () => {
    dns.set("img.example.com", ["93.184.215.14", "2606:50c0:8000::154"]);
    const all = vi.fn();
    publicLookup("img.example.com", { all: true }, all);
    await vi.waitFor(() => expect(all).toHaveBeenCalled());
    expect(all.mock.calls[0]).toEqual([
      null,
      [
        { address: "93.184.215.14", family: 4 },
        { address: "2606:50c0:8000::154", family: 6 },
      ],
    ]);
    const one = vi.fn();
    publicLookup("img.example.com", { family: 6 }, one);
    await vi.waitFor(() => expect(one).toHaveBeenCalled());
    expect(one.mock.calls[0]).toEqual([null, "2606:50c0:8000::154", 6]);
  });

  it("refuses a redirect to a private address", async () => {
    dns.set("img.example.com", ["93.184.215.14"]);
    dns.set("inside.example.com", ["169.254.169.254"]);
    routes.set(PICTURE.url, {
      status: 302,
      headers: { location: "https://inside.example.com/latest/meta-data" },
    });
    routes.set("https://inside.example.com/latest/meta-data", {
      status: 200,
      body: Buffer.from("secret"),
    });
    expect(await fetchPicture(PICTURE)).toBeNull();
    // Nothing was ever requested from the inside address.
    expect(net.request).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect off https", async () => {
    dns.set("img.example.com", ["93.184.215.14"]);
    routes.set(PICTURE.url, {
      status: 301,
      headers: { location: "http://img.example.com/a.png" },
    });
    expect(await fetchPicture(PICTURE)).toBeNull();
    expect(net.request).toHaveBeenCalledTimes(1);
  });

  it("refuses a picture over three megabytes, declared or not", async () => {
    dns.set("img.example.com", ["93.184.215.14"]);
    routes.set(PICTURE.url, {
      status: 200,
      headers: { "content-length": String(4 * 2 ** 20) },
      body: Buffer.from("x"),
    });
    expect(await fetchPicture(PICTURE)).toBeNull();
    routes.set(PICTURE.url, {
      status: 200,
      body: Buffer.alloc(3 * 2 ** 20 + 1),
    });
    expect(await fetchPicture(PICTURE)).toBeNull();
  });

  it("gives up as soon as the run is stopped, even mid-lookup", async () => {
    net.lookup.mockImplementation(() => new Promise(() => undefined));
    const stop = new AbortController();
    const fetching = fetchPicture(PICTURE, stop.signal);
    stop.abort(new Error("deadline"));
    expect(await fetching).toBeNull();

    dns.set("img.example.com", ["93.184.215.14"]);
    net.lookup.mockImplementation(async () => [
      { address: "93.184.215.14", family: 4 },
    ]);
    routes.set(PICTURE.url, { status: 200, hang: true });
    const aborted = new AbortController();
    const started = performance.now();
    const reading = readReadmeImages({
      readme: `![a](${PICTURE.url})`,
      owner: "acme",
      repo: "widget",
      branch: "HEAD",
      signal: aborted.signal,
    });
    setTimeout(() => aborted.abort(new Error("deadline")), 10);
    expect(await reading).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("keeps only whole, large enough pictures", async () => {
    dns.set("img.example.com", ["93.184.215.14"]);
    const readme = [1, 2, 3]
      .map((n) => `![p${n}](https://img.example.com/${n}.png)`)
      .join(" ");
    routes.set("https://img.example.com/1.png", {
      status: 200,
      body: Buffer.from(png(640, 480)),
    });
    // A bare header, and a picture too small to be more than an icon.
    routes.set("https://img.example.com/2.png", {
      status: 200,
      body: Buffer.from(png(640, 480).subarray(0, 33)),
    });
    routes.set("https://img.example.com/3.png", {
      status: 200,
      body: Buffer.from(png(64, 64)),
    });
    const kept = await readReadmeImages({
      readme,
      owner: "acme",
      repo: "widget",
      branch: "HEAD",
    });
    expect(kept.map((p) => [p.id, p.alt, p.width])).toEqual([
      ["img1", "p1", 640],
    ]);
  });
});
