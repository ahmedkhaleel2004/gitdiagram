// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: vi.fn(async () => "0"),
}));

import { requestGeo } from "~/server/http/vercel-geo";
import { viewAsCookie, viewAsCountry } from "./view-as";

const NOW = Date.parse("2026-09-29T20:00:00Z");

/** A request carrying the cookie a Set-Cookie line would give it. */
function withCookie(setCookie: string, headers: Record<string, string> = {}) {
  return new Request("https://gitdiagram.com/api/video", {
    headers: { cookie: setCookie.split(";")[0]!, ...headers },
  });
}

beforeEach(() => {
  vi.stubEnv("VIDEO_ADMIN_TOKEN", "x".repeat(40));
});

describe("view as a visitor from another country", () => {
  it("places the operator's browser in the country for 12 hours", () => {
    const request = withCookie(viewAsCookie("DE", NOW)!);
    expect(viewAsCountry(request, NOW)).toBe("DE");
    expect(viewAsCountry(request, NOW + 11 * 3_600_000)).toBe("DE");
    expect(viewAsCountry(request, NOW + 13 * 3_600_000)).toBeNull();
  });

  it("ignores a cookie anyone else made or changed", () => {
    const cookie = viewAsCookie("DE", NOW)!;
    expect(viewAsCountry(withCookie(cookie.replace("DE.", "US.")), NOW)).toBe(
      null,
    );
    vi.stubEnv("VIDEO_ADMIN_TOKEN", "y".repeat(40));
    expect(viewAsCountry(withCookie(cookie), NOW)).toBeNull();
    expect(viewAsCookie("germany", NOW)).toBeNull();
  });

  it("replaces where Vercel placed the request", () => {
    const headers = {
      "x-vercel-ip-country": "CA",
      "x-vercel-ip-country-region": "ON",
      "x-vercel-ip-city": "Ancaster",
      "x-vercel-ip-latitude": "43.2",
      "x-vercel-ip-longitude": "-79.9",
    };
    const plain = new Request("https://gitdiagram.com/", { headers });
    expect(requestGeo(plain)).toMatchObject({ country: "CA", region: "ON" });
    const previewing = withCookie(viewAsCookie("DE")!, headers);
    expect(requestGeo(previewing)).toEqual({
      country: "DE",
      region: "",
      city: "",
      lat: null,
      lon: null,
    });
  });
});
