import { afterEach, describe, expect, it } from "vitest";

import {
  getGenerateBasePath,
  getGenerationBackendMode,
} from "~/features/diagram/api";

const originalGenerationBackend = process.env.NEXT_PUBLIC_GENERATION_BACKEND;
const originalGenerateApiBaseUrl =
  process.env.NEXT_PUBLIC_GENERATE_API_BASE_URL;

afterEach(() => {
  if (originalGenerationBackend === undefined) {
    delete process.env.NEXT_PUBLIC_GENERATION_BACKEND;
  } else {
    process.env.NEXT_PUBLIC_GENERATION_BACKEND = originalGenerationBackend;
  }

  if (originalGenerateApiBaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_GENERATE_API_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_GENERATE_API_BASE_URL = originalGenerateApiBaseUrl;
  }
});

describe("getGenerationBackendMode", () => {
  it("defaults to next when the public backend env is missing", () => {
    delete process.env.NEXT_PUBLIC_GENERATION_BACKEND;

    expect(getGenerationBackendMode()).toBe("next");
  });

  it("returns the configured fastapi backend", () => {
    process.env.NEXT_PUBLIC_GENERATION_BACKEND = "fastapi";

    expect(getGenerationBackendMode()).toBe("fastapi");
  });
});

describe("getGenerateBasePath", () => {
  it("uses the next api route by default", () => {
    delete process.env.NEXT_PUBLIC_GENERATION_BACKEND;
    delete process.env.NEXT_PUBLIC_GENERATE_API_BASE_URL;

    expect(getGenerateBasePath()).toBe("/api/generate");
  });

  it("uses the configured fastapi base url when requested", () => {
    process.env.NEXT_PUBLIC_GENERATION_BACKEND = "fastapi";
    process.env.NEXT_PUBLIC_GENERATE_API_BASE_URL = "http://localhost:8000/";

    expect(getGenerateBasePath()).toBe("http://localhost:8000");
  });
});
