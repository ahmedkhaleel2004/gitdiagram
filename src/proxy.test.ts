// @vitest-environment node
import { describe, expect, it } from "vitest";

import { NextRequest } from "next/server";

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

  it("matches only requests carrying the Server Action header", () => {
    expect(config).toEqual({
      matcher: [
        {
          source: "/:path*",
          has: [{ type: "header", key: "next-action" }],
        },
      ],
    });
  });
});
