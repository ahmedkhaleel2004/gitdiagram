// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config, proxy } from "~/proxy";
import { recordAgentFetch } from "~/server/visibility/agent-fetch";

vi.mock("~/server/visibility/agent-fetch", () => ({
  recordAgentFetch: vi.fn(() => Promise.resolve()),
}));

const GPTBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";

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

  it.each([
    ["/fastapi/fastapi.md", {}, "/fastapi/fastapi/llms.txt"],
    ["/vercel/next.js.md", {}, "/vercel/next.js/llms.txt"],
    [
      "/vercel/next.js",
      { accept: "text/markdown, text/html;q=0.9" },
      "/vercel/next.js/llms.txt",
    ],
    ["/acme/demo", { accept: "text/markdown;q=1" }, "/acme/demo/llms.txt"],
  ])(
    "serves the Markdown twin of %s",
    (path, headers: Record<string, string>, target) => {
      const response = proxy(
        new NextRequest(`https://gitdiagram.com${path}`, { headers }),
      );
      expect(response.headers.get("x-middleware-rewrite")).toBe(
        `https://gitdiagram.com${target}`,
      );
    },
  );

  it.each([
    ["/acme/demo", "text/html,application/xhtml+xml,*/*;q=0.8"],
    ["/acme/demo", "text/markdownish"],
    ["/api/diagram-state", "text/markdown"],
    ["/sitemap/0.xml", "text/markdown"],
    ["/out/sponsor", "text/markdown"],
    ["/acme/demo/video", "text/markdown"],
  ])("leaves %s with Accept %s alone", (path, accept) => {
    const response = proxy(
      new NextRequest(`https://gitdiagram.com${path}`, { headers: { accept } }),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("lowercases a mixed-case Markdown URL before serving it", () => {
    const response = proxy(
      new NextRequest("https://gitdiagram.com/Acme/Demo.md"),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://gitdiagram.com/acme/demo.md",
    );
  });

  it.each([
    ["/acme/demo.md", {}, true],
    ["/acme/demo", { accept: "text/markdown" }, true],
    ["/acme/demo", { accept: "text/html" }, false],
    ["/acme/demo", {}, false],
    ["/api/thing.md", {}, false],
    ["/llms.txt", { accept: "text/markdown" }, false],
  ])(
    "runs for Markdown requests only: %s %o",
    (url, headers: Record<string, string>, matches) => {
      expect(unstable_doesMiddlewareMatch({ config, url, headers })).toBe(
        matches,
      );
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

  it.each([
    ["/fastapi/fastapi", GPTBOT, true],
    ["/llms.txt", GPTBOT, true],
    ["/", GPTBOT, true],
    ["/api/video", GPTBOT, false],
    ["/_next/static/chunk.js", GPTBOT, false],
    ["/fastapi/fastapi", BROWSER, false],
    ["/llms.txt", BROWSER, false],
  ])(
    "runs for known crawlers only, to count them: %s",
    (url, userAgent, matches) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url,
          headers: { "user-agent": userAgent },
        }),
      ).toBe(matches);
    },
  );

  it("counts a crawler fetch by the part of the site it was for", () => {
    const waitUntil = vi.fn();
    vi.mocked(recordAgentFetch).mockClear();
    proxy(
      new NextRequest("https://gitdiagram.com/fastapi/fastapi.md", {
        headers: { "user-agent": GPTBOT },
      }),
      { waitUntil } as never,
    );
    proxy(
      new NextRequest("https://gitdiagram.com/fastapi/fastapi", {
        headers: { "user-agent": GPTBOT },
      }),
      { waitUntil } as never,
    );
    expect(vi.mocked(recordAgentFetch).mock.calls).toEqual([
      [GPTBOT, "repo-md"],
      [GPTBOT, "repo"],
    ]);
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });
});
