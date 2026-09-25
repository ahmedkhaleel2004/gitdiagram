import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requestGeo } from "./vercel-geo";

describe("requestGeo", () => {
  it("reads Vercel's geolocation headers", () => {
    const request = new Request("https://gitdiagram.com", {
      headers: {
        "x-vercel-ip-country": "CA",
        "x-vercel-ip-country-region": "ON",
        "x-vercel-ip-city": "Qu%C3%A9bec",
        "x-vercel-ip-latitude": "43.65",
        "x-vercel-ip-longitude": "-79.38",
      },
    });
    expect(requestGeo(request)).toEqual({
      country: "CA",
      region: "ON",
      city: "Québec",
      lat: 43.65,
      lon: -79.38,
    });
  });

  it("is empty off Vercel and tolerates a malformed city", () => {
    expect(
      requestGeo(
        new Request("https://gitdiagram.com", {
          headers: { "x-vercel-ip-city": "%E0%A4%A" },
        }),
      ),
    ).toEqual({
      country: "",
      region: "",
      city: "%E0%A4%A",
      lat: null,
      lon: null,
    });
  });
});
