import { describe, expect, it } from "vitest";

import { getClientIp } from "~/server/http/client-ip";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://gitdiagram.com/api/generate/stream", {
    method: "POST",
    headers,
  });
}

describe("getClientIp", () => {
  it("takes the originating client from a proxy chain", () => {
    expect(
      getClientIp(
        requestWithHeaders({
          "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
        }),
      ),
    ).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(
      getClientIp(requestWithHeaders({ "x-real-ip": "203.0.113.9" })),
    ).toBe("203.0.113.9");
  });

  it("strips a port so one caller cannot occupy several buckets", () => {
    expect(
      getClientIp(
        requestWithHeaders({ "x-forwarded-for": "203.0.113.7:52814" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("preserves a full IPv6 address instead of truncating at the first colon", () => {
    expect(
      getClientIp(
        requestWithHeaders({ "x-forwarded-for": "2001:db8:0:0:0:0:0:1" }),
      ),
    ).toBe("2001:db8:0:0:0:0:0:1");
    expect(
      getClientIp(requestWithHeaders({ "x-forwarded-for": "[2001:db8::1]" })),
    ).toBe("2001:db8::1");
  });

  it("rejects values that are not addresses so they cannot forge a bucket", () => {
    expect(
      getClientIp(
        requestWithHeaders({ "x-forwarded-for": "not-an-ip; DROP TABLE" }),
      ),
    ).toBeNull();
    expect(getClientIp(requestWithHeaders({}))).toBeNull();
  });
});
