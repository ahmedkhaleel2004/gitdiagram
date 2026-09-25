import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isPublicAddress, probePicture, readmePictures } from "./readme-images";

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
        '![CI](https://github.com/acme/widget/workflows/ci/badge.svg) ![npm](https://img.shields.io/npm/v/widget) <img src="https://opencollective.com/widget/sponsors/0/avatar.svg">',
      ),
    ).toEqual([]);
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
});

/** A PNG header: signature, IHDR (and any chunks before the image data). */
function png(width: number, height: number, extra: string[] = []) {
  const chunk = (kind: string, body: number[]) => [
    ...u32(body.length),
    ...[...kind].map((c) => c.charCodeAt(0)),
    ...body,
    0,
    0,
    0,
    0,
  ];
  const u32 = (n: number) => [
    n >>> 24,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ];
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
  ]);
}

function webp(chunk: string, body: number[]) {
  const bytes = new Uint8Array(40);
  bytes.set(
    [..."RIFF"].map((c) => c.charCodeAt(0)),
    0,
  );
  bytes.set(
    [..."WEBP"].map((c) => c.charCodeAt(0)),
    8,
  );
  bytes.set(
    [...chunk].map((c) => c.charCodeAt(0)),
    12,
  );
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
    const jpeg = new Uint8Array(40);
    // SOI, an APP0 segment of 4 bytes, then SOF0 with height 600, width 800.
    jpeg.set([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 2, 88, 3, 32,
    ]);
    expect(probePicture(jpeg)).toEqual({
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

describe("public addresses", () => {
  it("refuses loopback, private, link-local and mapped private addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ])
      expect(isPublicAddress(address)).toBe(false);
    for (const address of [
      "140.82.112.3",
      "185.199.108.133",
      "2606:50c0:8000::154",
    ])
      expect(isPublicAddress(address)).toBe(true);
  });

  it("treats a trailing-dot local name as local", () => {
    expect(pictures("![a](https://localhost./a.png)")).toEqual([]);
  });
});
