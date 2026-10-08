import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { internalOrigin, segmentOrigin } from "./render-origin";

const originalEnv = { ...process.env };
const request = (url: string) => new Request(url);

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("render self-calls", () => {
  it("use loopback in a container, or the override", () => {
    Object.assign(process.env, { NODE_ENV: "production", PORT: "8080" });
    delete process.env.VIDEO_INTERNAL_ORIGIN;
    expect(internalOrigin(request("http://0.0.0.0:8080/api/x"))).toBe(
      "http://127.0.0.1:8080",
    );
    process.env.VIDEO_INTERNAL_ORIGIN = "http://render.internal:9000/";
    expect(internalOrigin(request("http://0.0.0.0:8080/api/x"))).toBe(
      "http://render.internal:9000",
    );
  });

  it("post segments to the server itself unless a router is named", () => {
    Object.assign(process.env, { NODE_ENV: "production", PORT: "3000" });
    delete process.env.VIDEO_INTERNAL_ORIGIN;
    delete process.env.VIDEO_SEGMENT_ORIGIN;
    const incoming = request("http://0.0.0.0:3000/api/video/render");
    expect(segmentOrigin(incoming)).toBe("http://127.0.0.1:3000");
    process.env.VIDEO_SEGMENT_ORIGIN = "https://gitdiagram.com/";
    expect(segmentOrigin(incoming)).toBe("https://gitdiagram.com");
    // The stage still loads from this instance.
    expect(internalOrigin(incoming)).toBe("http://127.0.0.1:3000");
  });

  it("use the request's origin in development", () => {
    Object.assign(process.env, { NODE_ENV: "development", PORT: "3000" });
    delete process.env.VIDEO_INTERNAL_ORIGIN;
    expect(internalOrigin(request("http://localhost:3000/api/x"))).toBe(
      "http://localhost:3000",
    );
  });
});
