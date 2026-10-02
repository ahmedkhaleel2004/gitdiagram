// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config } from "~/proxy";
import {
  COUNTED_AGENT_PATTERN,
  entersProxy,
  proxyDecision,
} from "./proxy-rules";

vi.mock("~/server/visibility/agent-fetch", () => ({
  recordAgentFetch: vi.fn(() => Promise.resolve()),
}));

const GPTBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";

describe("entersProxy", () => {
  it("names the same crawlers as the proxy's matcher", () => {
    const literals = JSON.stringify(config.matcher);
    expect(literals).toContain(JSON.stringify(`.*${COUNTED_AGENT_PATTERN}.*`));
  });

  // The Worker on Cloudflare has no Next.js to apply the proxy's matcher, so
  // this function must admit exactly the requests the matcher does.
  const paths = [
    "/",
    "/browse",
    "/videos",
    "/llms.txt",
    "/acme/demo",
    "/acme/demo/",
    "/Acme/demo",
    "/acme/Demo",
    "/Acme/Demo/opengraph-image",
    "/acme/demo/opengraph-image",
    "/acme/demo/video",
    "/acme/Demo/video",
    "/acme/demo.md",
    "/Acme/Demo.md",
    "/acme/demo/tree/main/src",
    "/api/diagram-state",
    "/api/Private",
    "/api/video/Foo.md",
    "/phx9a/UPPERCASE",
    "/phx9a/e/",
    "/_next/static/chunks/ABC.js",
    "/mcp",
    "/sitemap/0.xml",
    "/robots.txt",
  ];
  const headerSets: Array<Record<string, string>> = [
    { "user-agent": BROWSER },
    { "user-agent": GPTBOT },
    { "user-agent": BROWSER, accept: "text/markdown" },
    { "user-agent": BROWSER, accept: "text/html, text/markdown;q=0.9" },
    { "user-agent": BROWSER, "next-action": "x" },
    {},
  ];
  const cases = paths.flatMap((path) =>
    headerSets.map((headers) => ({ path, headers })),
  );
  it.each(cases)("$path with $headers", ({ path, headers }) => {
    expect(entersProxy(path, new Headers(headers))).toBe(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: `https://gitdiagram.com${path}`,
        headers,
      }),
    );
  });
});

describe("proxyDecision", () => {
  const decide = (
    path: string,
    headers: Record<string, string> = {},
    method = "GET",
  ) => proxyDecision(method, path, new Headers(headers));

  it("rejects forged Server Actions and counts nothing", () => {
    expect(decide("/", { "next-action": "x" }, "POST")).toEqual({
      decision: { action: "reject" },
      surface: null,
    });
  });

  it("sends mixed-case repository URLs to their lowercase address", () => {
    expect(decide("/Acme/Demo").decision).toEqual({
      action: "redirect",
      pathname: "/acme/demo",
    });
    expect(decide("/Acme/Demo", {}, "POST").decision).toEqual({
      action: "next",
    });
    expect(decide("/api/Private").decision).toEqual({ action: "next" });
  });

  it("serves the Markdown twin by extension or by Accept", () => {
    expect(decide("/acme/demo.md")).toEqual({
      decision: { action: "rewrite", pathname: "/acme/demo/llms.txt" },
      surface: "repo-md",
    });
    expect(decide("/acme/demo", { accept: "text/markdown" }).decision).toEqual({
      action: "rewrite",
      pathname: "/acme/demo/llms.txt",
    });
    expect(decide("/acme/demo", { accept: "text/html" })).toEqual({
      decision: { action: "next" },
      surface: "repo",
    });
    expect(decide("/api/demo.md").decision).toEqual({ action: "next" });
  });

  it("names the surface a fetch is counted under", () => {
    expect(decide("/").surface).toBe("home");
    expect(decide("/llms.txt").surface).toBe("llms.txt");
    expect(decide("/acme/demo/video").surface).toBe("watch");
    expect(decide("/videos").surface).toBe("videos");
  });
});
