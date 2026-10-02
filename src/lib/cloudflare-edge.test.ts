import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRON_ROUTES,
  containerRefusal,
  edgeAnswerKey,
  edgeDecision,
  runsWhereTheVisitorIs,
  isPagePath,
  isSharedCacheRequest,
  matchesEtag,
  sharedLifetime,
  isContainerPath,
  isScannerPath,
  platformHeaders,
  visitorCacheControl,
} from "./cloudflare-edge";

const SITE = new URL("https://gitdiagram.com/vercel/next.js");

describe("platformHeaders", () => {
  it("fills Vercel-style geolocation from Cloudflare", () => {
    const headers = platformHeaders(
      new Headers({ "cf-connecting-ip": "203.0.113.7", accept: "text/html" }),
      {
        country: "FR",
        regionCode: "IDF",
        city: "Saint-Rémy",
        latitude: "48.70650",
        longitude: "2.07140",
      },
      SITE,
    );
    expect(headers.get("x-vercel-ip-country")).toBe("FR");
    expect(headers.get("x-vercel-ip-country-region")).toBe("IDF");
    expect(decodeURIComponent(headers.get("x-vercel-ip-city") ?? "")).toBe(
      "Saint-Rémy",
    );
    expect(headers.get("x-vercel-ip-latitude")).toBe("48.70650");
    expect(headers.get("x-vercel-ip-longitude")).toBe("2.07140");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(headers.get("x-real-ip")).toBe("203.0.113.7");
    expect(headers.get("accept")).toBe("text/html");
  });

  it("drops a caller's own platform headers", () => {
    const headers = platformHeaders(
      new Headers({
        "x-vercel-ip-country": "US",
        "x-vercel-ip-country-region": "CA",
        "x-vercel-ip-city": "San%20Francisco",
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "x-real-ip": "1.2.3.4",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "http",
        "cf-connecting-ip": "198.51.100.9",
      }),
      { country: "IN" },
      SITE,
    );
    expect(headers.get("x-forwarded-host")).toBe("gitdiagram.com");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-vercel-ip-country")).toBe("IN");
    expect(headers.get("x-vercel-ip-country-region")).toBeNull();
    expect(headers.get("x-vercel-ip-city")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBe("198.51.100.9");
    expect(headers.get("x-real-ip")).toBe("198.51.100.9");
  });

  it("leaves the place empty when Cloudflare does not know it", () => {
    const headers = platformHeaders(
      new Headers({
        "x-vercel-ip-country": "US",
        "x-forwarded-for": "1.1.1.1",
      }),
      { country: "T1", latitude: "nope", longitude: "2" },
      SITE,
    );
    expect(headers.get("x-vercel-ip-country")).toBeNull();
    expect(headers.get("x-vercel-ip-latitude")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(
      platformHeaders(new Headers(), undefined, SITE).has("x-real-ip"),
    ).toBe(false);
  });
});

describe("isContainerPath", () => {
  it("names only the routes that need ffmpeg or Chromium", () => {
    expect(isContainerPath("/api/video/generate")).toBe(true);
    expect(isContainerPath("/api/video/render")).toBe(true);
    expect(isContainerPath("/api/video/render/segment/")).toBe(true);
    expect(isContainerPath("/api/video")).toBe(false);
    expect(isContainerPath("/api/video/file")).toBe(false);
    expect(isContainerPath("/api/video/catalog")).toBe(false);
    expect(isContainerPath("/api/generate/stream")).toBe(false);
  });
});

describe("CRON_ROUTES", () => {
  it("matches vercel.json and wrangler.jsonc", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(CRON_ROUTES).toEqual(
      Object.fromEntries(
        vercel.crons.map((cron) => [cron.schedule, cron.path]),
      ),
    );
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    for (const schedule of Object.keys(CRON_ROUTES))
      expect(wrangler).toContain(JSON.stringify(schedule));
  });
});

describe("edgeDecision", () => {
  it("rate-limits the four generation routes", () => {
    expect(edgeDecision("/api/generate/stream", null)).toEqual({
      action: "limit",
      limit: "LIMIT_GENERATE_STREAM",
    });
    expect(edgeDecision("/api/diagram-state", "x")).toEqual({
      action: "limit",
      limit: "LIMIT_DIAGRAM_STATE",
    });
    expect(edgeDecision("/api/video", null)).toBeNull();
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    for (const path of ["stream", "cost", "cancel"]) {
      const decision = edgeDecision(`/api/generate/${path}`, null);
      expect(decision?.action).toBe("limit");
      if (decision?.action === "limit")
        expect(wrangler).toContain(`"${decision.limit}"`);
    }
  });

  it("keeps the blocked crawlers off repository pages only", () => {
    const claude =
      "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";
    expect(edgeDecision("/vercel/next.js", claude)?.action).toBe("deny");
    expect(edgeDecision("/vercel/next.js/", claude)?.action).toBe("deny");
    expect(
      edgeDecision("/vercel/next.js/opengraph-image", claude)?.action,
    ).toBe("limit");
    expect(edgeDecision("/", claude)).toBeNull();
    expect(edgeDecision("/videos", claude)).toBeNull();
    expect(edgeDecision("/vercel/next.js/video", claude)).toBeNull();
    expect(edgeDecision("/sitemap/0.xml", claude)).toBeNull();
    expect(edgeDecision("/api/video", claude)).toBeNull();
    expect(edgeDecision("/vercel/next.js", "Claude-User/1.0")?.action).toBe(
      "limit",
    );

    const amazon = "Mozilla/5.0 (compatible; Amazonbot/0.1)";
    expect(edgeDecision("/a/b", amazon)?.action).toBe("deny");
    expect(edgeDecision("/a/b/opengraph-image", amazon)?.action).toBe("deny");
    expect(edgeDecision("/a/b/twitter-image", amazon)?.action).toBe("deny");
    expect(edgeDecision("/a/b/diagram.png", amazon)).toBeNull();
    expect(edgeDecision("/a/b", "Brightbot 1.0")?.action).toBe("deny");
    expect(edgeDecision("/a/b", "Brightbot 1.0 extra")?.action).toBe("limit");
    // A verified crawler is still refused where its rule says so.
    expect(edgeDecision("/a/b", amazon, true)?.action).toBe("deny");
  });

  it("limits repository pages per address, except for verified crawlers", () => {
    const limited = { action: "limit", limit: "LIMIT_REPO_PAGE" };
    const browser = "Mozilla/5.0 Safari";
    expect(edgeDecision("/a/b", browser)).toEqual(limited);
    expect(edgeDecision("/a/b.md", browser)).toEqual(limited);
    expect(edgeDecision("/a/b/opengraph-image", browser)).toEqual(limited);
    expect(edgeDecision("/a/b", "bingbot/2.0", true)).toBeNull();
    for (const path of [
      "/",
      "/browse",
      "/videos",
      "/a/b/video",
      "/api/video",
      "/sitemap/0.xml",
      "/out/sent",
      "/mcp-app/view.js",
    ])
      expect(edgeDecision(path, browser)).toBeNull();
    expect(readFileSync("wrangler.jsonc", "utf8")).toContain(
      '"LIMIT_REPO_PAGE"',
    );
  });

  it("answers scanner paths without the app", () => {
    for (const path of [
      "/wp-login.php",
      "/.env",
      "/.git/config",
      "/.aws/credentials",
      "/s3/.aws/config",
      "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php",
      "/wp-content/plugins/forminator/forminator.php",
      "/index.PHP",
      "/cgi-bin/luci/stok.cgi",
    ]) {
      expect(isScannerPath(path)).toBe(true);
      expect(edgeDecision(path, "x")).toEqual({ action: "missing" });
    }
    for (const path of [
      "/",
      "/robots.txt",
      "/.well-known/openai-apps-challenge",
      "/owner/.github",
      "/owner/tool.php",
      "/owner/repo",
      "/owner/repo/video",
      "/owner/repo/opengraph-image",
      "/owner/repo.md",
      "/api/video/file",
      "/api/internal/.x/y",
      "/_next/static/chunks/a.js",
      "/wp-json/wp/v2/pages",
    ])
      expect(isScannerPath(path)).toBe(false);
  });
});

describe("visitorCacheControl", () => {
  it("keeps the platform cache's directives away from visitors", () => {
    expect(
      visitorCacheControl("s-maxage=300, stale-while-revalidate=31535700"),
    ).toBe("public, max-age=0, must-revalidate");
    expect(
      visitorCacheControl(
        "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
      ),
    ).toBe("public, max-age=0");
  });

  it("leaves everything else alone", () => {
    for (const value of [
      "public, max-age=300, stale-while-revalidate=86400",
      "no-store",
      "private, no-cache, no-store, max-age=0, must-revalidate",
      "public, max-age=31536000, immutable",
    ])
      expect(visitorCacheControl(value)).toBe(value);
  });
});

describe("containerRefusal", () => {
  const url = new URL("https://gitdiagram.com/api/video/generate");
  it("lets a same-origin POST through to a container", () => {
    expect(
      containerRefusal("POST", url.pathname, "https://gitdiagram.com", url),
    ).toBeNull();
    // Segment jobs are signed; the router checks them.
    expect(
      containerRefusal("POST", "/api/video/render/segment", null, url),
    ).toBeNull();
  });

  it("answers what the route would, without waking a container", () => {
    expect(containerRefusal("GET", url.pathname, null, url)).toEqual({
      status: 405,
    });
    expect(containerRefusal("POST", url.pathname, null, url)).toEqual({
      status: 403,
      error: "Video generation must come from GitDiagram.",
    });
    expect(
      containerRefusal(
        "POST",
        "/api/video/render",
        "https://evil.example",
        url,
      ),
    ).toEqual({
      status: 403,
      error: "Video downloads must come from GitDiagram.",
    });
    expect(
      containerRefusal("POST", url.pathname, "not a url", url)?.status,
    ).toBe(403);
  });
});

describe("sharedLifetime", () => {
  const lifetime = (headers: Record<string, string>, status = 200) =>
    sharedLifetime(status, new Headers(headers));

  it("reads s-maxage and stale-while-revalidate", () => {
    expect(
      lifetime({
        "cache-control":
          "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
      }),
    ).toEqual({ fresh: 60, stale: 600 });
    expect(
      lifetime({
        "cache-control":
          "public, max-age=31536000, s-maxage=31536000, immutable",
      }),
    ).toEqual({ fresh: 31536000, stale: 0 });
  });

  it("prefers CDN-Cache-Control", () => {
    expect(
      lifetime({
        "cache-control": "public, max-age=60",
        "cdn-cache-control": "public, max-age=60, stale-while-revalidate=600",
      }),
    ).toEqual({ fresh: 60, stale: 600 });
  });

  it.each([
    [{ "cache-control": "public, max-age=3600" }],
    [{ "cache-control": "no-store" }],
    [{ "cache-control": "private, s-maxage=60" }],
    [{ "cache-control": "public, s-maxage=0" }],
    [{ "cache-control": "s-maxage=60", "set-cookie": "gd_visitor=1" }],
    [{ "cache-control": "no-store", "cdn-cache-control": "max-age=60" }],
    [{}],
  ])("keeps nothing for %o", (headers) => {
    expect(lifetime(headers as Record<string, string>)).toBeNull();
  });

  it("keeps only successful answers", () => {
    expect(lifetime({ "cache-control": "s-maxage=60" }, 404)).toBeNull();
    expect(lifetime({ "cache-control": "s-maxage=60" }, 206)).toBeNull();
  });
});

describe("isSharedCacheRequest", () => {
  const shared = (
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ) => isSharedCacheRequest(method, path, new Headers(headers));

  it("admits plain reads of API routes", () => {
    expect(shared("GET", "/api/video")).toBe(true);
    expect(shared("GET", "/api/video/file", { cookie: "gd_visitor=1" })).toBe(
      true,
    );
  });

  it("leaves everything else to the route", () => {
    expect(shared("POST", "/api/video")).toBe(false);
    expect(shared("HEAD", "/api/video")).toBe(false);
    expect(shared("GET", "/acme/demo")).toBe(false);
    expect(shared("GET", "/api/internal/revalidate")).toBe(false);
    expect(shared("GET", "/api/admin/state")).toBe(false);
    expect(shared("GET", "/api/video", { authorization: "Bearer x" })).toBe(
      false,
    );
    expect(shared("GET", "/api/video/file", { range: "bytes=0-" })).toBe(false);
  });
});

describe("edgeAnswerKey", () => {
  it("ignores the order of query parameters, not their values", () => {
    const key = (address: string) => edgeAnswerKey(new URL(address));
    expect(key("https://gitdiagram.com/api/video?username=a&repo=b")).toBe(
      key("https://gitdiagram.com/api/video?repo=b&username=a"),
    );
    expect(key("https://gitdiagram.com/api/video?username=a&repo=b")).not.toBe(
      key("https://gitdiagram.com/api/video?username=A&repo=b"),
    );
    expect(key("https://gitdiagram.com/api/video?username=a&repo=b")).not.toBe(
      key("https://perf.gitdiagram.com/api/video?username=a&repo=b"),
    );
    expect(key("https://gitdiagram.com/api/video/catalog")).toBe(
      "http://edge-answers.local/gitdiagram.com/api/video/catalog",
    );
  });
});

describe("matchesEtag", () => {
  it("compares weakly, across a list", () => {
    expect(matchesEtag('"abc"', '"abc"')).toBe(true);
    expect(matchesEtag('W/"abc"', '"abc"')).toBe(true);
    expect(matchesEtag('"abc"', 'W/"abc"')).toBe(true);
    expect(matchesEtag('"x", W/"abc"', '"abc"')).toBe(true);
    expect(matchesEtag("*", '"abc"')).toBe(true);
  });

  it("does not match another tag, a missing one or a malformed one", () => {
    expect(matchesEtag('"abd"', '"abc"')).toBe(false);
    expect(matchesEtag(null, '"abc"')).toBe(false);
    expect(matchesEtag('"abc"', null)).toBe(false);
    expect(matchesEtag("abc", "abc")).toBe(false);
  });
});

describe("runsWhereTheVisitorIs", () => {
  const local = (method: string, path: string) =>
    runsWhereTheVisitorIs(method, new URL(path, "https://gitdiagram.com"));

  it("keeps diagram runs out of the placed server", () => {
    expect(local("POST", "/api/generate/stream")).toBe(true);
    expect(local("POST", "/api/generate/stream/")).toBe(true);
    expect(local("GET", "/api/generate/stream")).toBe(false);
    expect(local("POST", "/api/generate/cost")).toBe(false);
    expect(local("POST", "/api/generate/cancel")).toBe(false);
  });

  it("keeps what loads the whole browse index out of it", () => {
    expect(local("GET", "/api/internal/browse-index/drain")).toBe(true);
    expect(local("GET", "/api/internal/video-payments/sweep")).toBe(true);
    expect(local("POST", "/mcp")).toBe(true);
    expect(local("GET", "/sitemap/0.xml")).toBe(true);
    expect(local("GET", "/browse?q=next")).toBe(true);
    expect(local("GET", "/browse?sort=stars_desc")).toBe(true);
    expect(local("GET", "/browse?minStars=100")).toBe(true);
    expect(local("GET", "/browse?page=51")).toBe(true);
    expect(local("GET", "/api/browse-index?q=next&_rsc=1")).toBe(true);
  });

  it("leaves pages, the first browse pages and short API calls where the data is", () => {
    expect(local("GET", "/browse")).toBe(false);
    expect(local("GET", "/browse?page=3&_rsc=abc")).toBe(false);
    expect(local("GET", "/browse?sort=recent_desc&q=%20")).toBe(false);
    expect(local("GET", "/api/browse-index")).toBe(false);
    expect(local("GET", "/")).toBe(false);
    expect(local("GET", "/acme/demo")).toBe(false);
    expect(local("POST", "/api/diagram-state")).toBe(false);
    expect(local("GET", "/api/video?username=a&repo=b")).toBe(false);
    expect(local("GET", "/sitemap.xml")).toBe(false);
    expect(local("GET", "/mcp-app/diagram-view.js")).toBe(false);
  });
});

describe("the two server Workers", () => {
  // wrangler.server-local.jsonc is wrangler.server.jsonc where the visitor
  // is: the same bindings and settings, another name, no placement.
  const config = (file: string) =>
    JSON.parse(
      readFileSync(file, "utf8")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/,(\s*[}\]])/g, "$1"),
    ) as Record<string, unknown>;

  it("differ only in name and placement", () => {
    const { name, placement, ...placed } = config("wrangler.server.jsonc");
    const { name: localName, ...local } = config("wrangler.server-local.jsonc");
    expect(name).toBe("gitdiagram-server");
    expect(localName).toBe("gitdiagram-server-local");
    expect(placement).toBeDefined();
    expect(local).toEqual(placed);
  });

  it("the edge Worker counts repository pages on the site's Worker's limiter", () => {
    const limiter = (file: string) =>
      (
        config(file).ratelimits as { name: string; namespace_id: string }[]
      ).find(({ name }) => name === "LIMIT_REPO_PAGE");
    expect(limiter("wrangler.edge.jsonc")).toEqual(limiter("wrangler.jsonc"));
    expect(config("wrangler.edge.jsonc").services).toEqual([
      { binding: "SITE", service: "gitdiagram" },
      { binding: "SERVER", service: "gitdiagram-server" },
    ]);
    // The routes are the edge Worker's (scripts/cf-routes.mjs); a Worker
    // that listed them would fight it for them at every deploy.
    expect(config("wrangler.jsonc").routes).toBeUndefined();
    expect(config("wrangler.edge.jsonc").routes).toBeUndefined();
  });

  it("are both bound in the site's Worker", () => {
    const services = config("wrangler.jsonc").services as {
      binding: string;
      service: string;
    }[];
    expect(services).toEqual(
      expect.arrayContaining([
        { binding: "SERVER", service: "gitdiagram-server" },
        { binding: "SERVER_LOCAL", service: "gitdiagram-server-local" },
      ]),
    );
  });
});

describe("isPagePath", () => {
  it.each([
    "/",
    "/videos",
    "/browse/",
    "/acme/demo",
    "/vercel/next.js",
    "/acme/demo/video",
  ])("%s is a page", (path) => expect(isPagePath(path)).toBe(true));
  it.each([
    "/robots.txt",
    "/llms.txt",
    "/acme/demo/opengraph-image",
    "/acme/demo/diagram.png",
    "/acme/demo/tree/main",
    "/sitemap/0.xml/x/y",
  ])("%s is not", (path) => expect(isPagePath(path)).toBe(false));
});
