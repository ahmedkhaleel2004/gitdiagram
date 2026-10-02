import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRON_ROUTES,
  containerRefusal,
  edgeDecision,
  isContainerPath,
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
    expect(edgeDecision("/vercel/next.js/opengraph-image", claude)).toBeNull();
    expect(edgeDecision("/", claude)).toBeNull();
    expect(edgeDecision("/videos", claude)).toBeNull();
    expect(edgeDecision("/vercel/next.js/video", claude)).toBeNull();
    expect(edgeDecision("/sitemap/0.xml", claude)).toBeNull();
    expect(edgeDecision("/api/video", claude)).toBeNull();
    expect(edgeDecision("/vercel/next.js", "Claude-User/1.0")).toBeNull();

    const amazon = "Mozilla/5.0 (compatible; Amazonbot/0.1)";
    expect(edgeDecision("/a/b", amazon)?.action).toBe("deny");
    expect(edgeDecision("/a/b/opengraph-image", amazon)?.action).toBe("deny");
    expect(edgeDecision("/a/b/twitter-image", amazon)?.action).toBe("deny");
    expect(edgeDecision("/a/b/diagram.png", amazon)).toBeNull();
    expect(edgeDecision("/a/b", "Brightbot 1.0")?.action).toBe("deny");
    expect(edgeDecision("/a/b", "Brightbot 1.0 extra")).toBeNull();
    expect(edgeDecision("/a/b", "Mozilla/5.0 Safari")).toBeNull();
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
