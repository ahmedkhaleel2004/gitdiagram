import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRON_ROUTES,
  isContainerPath,
  platformHeaders,
} from "./cloudflare-edge";

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
        "cf-connecting-ip": "198.51.100.9",
      }),
      { country: "IN" },
    );
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
    );
    expect(headers.get("x-vercel-ip-country")).toBeNull();
    expect(headers.get("x-vercel-ip-latitude")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(platformHeaders(new Headers(), undefined).has("x-real-ip")).toBe(
      false,
    );
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
