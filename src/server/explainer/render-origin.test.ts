import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deploymentHeaders,
  internalOrigin,
  pinToDeployment,
} from "./render-origin";

const originalEnv = { ...process.env };
const request = (url: string) => new Request(url);

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("render self-calls", () => {
  it("pin the stage and requests to the running deployment on Vercel", () => {
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_abc";
    expect(
      pinToDeployment("https://gitdiagram.com/video-engine/stage.html?v=18"),
    ).toBe("https://gitdiagram.com/video-engine/stage.html?v=18&dpl=dpl_abc");
    expect(deploymentHeaders()).toEqual({ "x-deployment-id": "dpl_abc" });
  });

  it("are left alone off Vercel", () => {
    delete process.env.VERCEL_DEPLOYMENT_ID;
    const url = "http://localhost:3000/video-engine/stage.html?v=18";
    expect(pinToDeployment(url)).toBe(url);
    expect(deploymentHeaders()).toEqual({});
  });

  it("use the public origin on Vercel, loopback in a container, or the override", () => {
    Object.assign(process.env, { NODE_ENV: "production", PORT: "8080" });
    delete process.env.VIDEO_INTERNAL_ORIGIN;
    process.env.VERCEL = "1";
    expect(internalOrigin(request("https://gitdiagram.com/api/x"))).toBe(
      "https://gitdiagram.com",
    );
    delete process.env.VERCEL;
    expect(internalOrigin(request("http://0.0.0.0:8080/api/x"))).toBe(
      "http://127.0.0.1:8080",
    );
    process.env.VIDEO_INTERNAL_ORIGIN = "http://render.internal:9000/";
    expect(internalOrigin(request("http://0.0.0.0:8080/api/x"))).toBe(
      "http://render.internal:9000",
    );
  });

  it("use the request's origin in development", () => {
    Object.assign(process.env, { NODE_ENV: "development", PORT: "3000" });
    delete process.env.VERCEL;
    delete process.env.VIDEO_INTERNAL_ORIGIN;
    expect(internalOrigin(request("http://localhost:3000/api/x"))).toBe(
      "http://localhost:3000",
    );
  });
});
