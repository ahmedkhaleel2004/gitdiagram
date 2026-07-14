// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "~/server/http/same-origin";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("isSameOriginRequest", () => {
  it("accepts a direct same-origin browser request", () => {
    expect(
      isSameOriginRequest(
        request("https://gitdiagram.com/api/diagram-state", {
          origin: "https://gitdiagram.com",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  it("uses forwarded host and protocol behind a TLS-terminating proxy", () => {
    expect(
      isSameOriginRequest(
        request("http://0.0.0.0:8080/api/diagram-state", {
          host: "0.0.0.0:8080",
          origin: "https://standby.gitdiagram.com",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "standby.gitdiagram.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(true);
  });

  it("uses the first value from standard forwarded header chains", () => {
    expect(
      isSameOriginRequest(
        request("http://0.0.0.0:8080/api/generate/cancel", {
          origin: "https://api.gitdiagram.com",
          "x-forwarded-host": "api.gitdiagram.com, internal.local:8080",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a mismatched origin", () => {
    expect(
      isSameOriginRequest(
        request("http://0.0.0.0:8080/api/diagram-state", {
          origin: "https://attacker.example",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "standby.gitdiagram.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(false);
  });

  it("rejects a forwarded host that does not match the origin", () => {
    expect(
      isSameOriginRequest(
        request("http://0.0.0.0:8080/api/diagram-state", {
          origin: "https://standby.gitdiagram.com",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(false);
  });

  it("rejects a forwarded protocol that does not match the origin", () => {
    expect(
      isSameOriginRequest(
        request("http://0.0.0.0:8080/api/diagram-state", {
          origin: "https://standby.gitdiagram.com",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "standby.gitdiagram.com",
          "x-forwarded-proto": "http",
        }),
      ),
    ).toBe(false);
  });

  it("fails closed when an internal HTTP request omits forwarded protocol", () => {
    expect(
      isSameOriginRequest(
        request("http://0.0.0.0:8080/api/diagram-state", {
          origin: "https://standby.gitdiagram.com",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "standby.gitdiagram.com",
        }),
      ),
    ).toBe(false);
  });

  it("rejects a cross-site fetch even when the origin otherwise matches", () => {
    expect(
      isSameOriginRequest(
        request("https://gitdiagram.com/api/diagram-state", {
          origin: "https://gitdiagram.com",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
  });

  it("rejects missing, malformed, and non-HTTP origins", () => {
    expect(
      isSameOriginRequest(request("https://gitdiagram.com/api/diagram-state")),
    ).toBe(false);
    expect(
      isSameOriginRequest(
        request("https://gitdiagram.com/api/diagram-state", {
          origin: "not a URL",
        }),
      ),
    ).toBe(false);
    expect(
      isSameOriginRequest(
        request("http://0.0.0.0:8080/api/diagram-state", {
          origin: "https://gitdiagram.com",
          "x-forwarded-host": "gitdiagram.com",
          "x-forwarded-proto": "javascript",
        }),
      ),
    ).toBe(false);
  });
});
