// @vitest-environment node
import { describe, expect, it } from "vitest";

import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config, proxy } from "~/proxy";

describe("proxy", () => {
  it("rejects forged Server Action requests without caching the response", () => {
    const response = proxy(
      new NextRequest("https://gitdiagram.com/", {
        method: "POST",
        headers: { "Next-Action": "x" },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("allows ordinary requests as defense in depth", () => {
    const response = proxy(new NextRequest("https://gitdiagram.com/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("preserves campaign parameters when canonicalizing repository URLs", () => {
    const response = proxy(
      new NextRequest("https://gitdiagram.com/Acme/Demo?utm_source=GitHub"),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://gitdiagram.com/acme/demo?utm_source=GitHub",
    );
  });

  it.each([
    ["/Acme/demo", true],
    ["/acme/Demo", true],
    ["/Acme/Demo/opengraph-image", true],
    ["/acme/demo", false],
    ["/acme/demo/opengraph-image", false],
    ["/api/diagram-state", false],
    ["/api/Private", false],
    ["/phx9a/UPPERCASE", false],
    ["/_next/static/chunks/ABC.js", false],
    ["/browse", false],
    ["/", false],
  ])(
    "runs normalization only for mixed-case repository URLs: %s",
    (url, matches) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(matches);
    },
  );

  it("still matches forged actions on any path", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: "/api/generate/stream",
        headers: { "next-action": "x" },
      }),
    ).toBe(true);
  });
});
