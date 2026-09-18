import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("analytics region context", () => {
  it("returns only coarse codes and prevents sharing one visitor's location through a cache", async () => {
    const response = GET(
      new Request("https://gitdiagram.com/api/analytics-context", {
        headers: {
          "x-vercel-ip-country": "US",
          "x-vercel-ip-country-region": "CA",
          "x-vercel-ip-city": "San Francisco",
          "x-forwarded-for": "192.0.2.1",
        },
      }),
    );

    expect(await response.json()).toEqual({ country: "US", region: "CA" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not guess a region when hosting headers are missing or malformed", async () => {
    const response = GET(
      new Request("https://gitdiagram.com/api/analytics-context", {
        headers: { "x-vercel-ip-country-region": "California" },
      }),
    );
    expect(await response.json()).toEqual({ country: "", region: "" });
  });
});
