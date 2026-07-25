// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkR2Bucket, checkUpstashConnection } = vi.hoisted(() => ({
  checkR2Bucket: vi.fn(),
  checkUpstashConnection: vi.fn(),
}));

vi.mock("~/server/storage/r2", () => ({
  checkR2Bucket,
}));
vi.mock("~/server/storage/upstash", () => ({
  checkUpstashConnection,
}));

import { checkReadiness } from "~/server/readiness";

const requiredEnvironment = {
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "test-provider-key",
  R2_PUBLIC_BUCKET: "public-bucket",
  R2_PRIVATE_BUCKET: "private-bucket",
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  CACHE_KEY_SECRET: "cache-secret",
};

describe("checkReadiness", () => {
  beforeEach(() => {
    Object.assign(process.env, requiredEnvironment);
    checkR2Bucket.mockReset();
    checkUpstashConnection.mockReset();
    checkR2Bucket.mockResolvedValue(undefined);
    checkUpstashConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const name of Object.keys(requiredEnvironment)) {
      delete process.env[name];
    }
    vi.restoreAllMocks();
  });

  it("checks both storage buckets, Redis, configuration, and provider key", async () => {
    await expect(checkReadiness()).resolves.toMatchObject({
      ok: true,
      checks: {
        configuration: true,
        provider: true,
        publicStorage: true,
        privateStorage: true,
        redis: true,
      },
    });
    expect(checkR2Bucket).toHaveBeenCalledWith("public-bucket");
    expect(checkR2Bucket).toHaveBeenCalledWith("private-bucket");
    expect(checkUpstashConnection).toHaveBeenCalledOnce();
  });

  it("fails readiness without calling dependencies when configuration is incomplete", async () => {
    delete process.env.R2_ACCESS_KEY_ID;

    await expect(checkReadiness()).resolves.toMatchObject({
      ok: false,
      checks: { configuration: false },
    });
    expect(checkR2Bucket).not.toHaveBeenCalled();
    expect(checkUpstashConnection).not.toHaveBeenCalled();
  });

  it("fails readiness when a dependency check rejects", async () => {
    checkUpstashConnection.mockRejectedValue(new Error("unavailable"));

    await expect(checkReadiness()).resolves.toMatchObject({
      ok: false,
      checks: { redis: false },
    });
  });
});
