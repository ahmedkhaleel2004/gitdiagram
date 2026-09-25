import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readmePictures } from "./readme-images";

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
