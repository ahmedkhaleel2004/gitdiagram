import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  config: undefined as Record<string, unknown> | undefined,
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(readonly input: unknown) {}
  }
  return {
    S3Client: class {
      constructor(config: Record<string, unknown>) {
        sdk.config = config;
      }
      send = sdk.send;
    },
    GetObjectCommand: class extends Command {},
    PutObjectCommand: class extends Command {},
    HeadObjectCommand: class extends Command {},
  };
});

import {
  getJsonObject,
  getObjectInfo,
  putBinaryObject,
  R2_ATTEMPT_TIMEOUT_MS,
  R2_REQUEST_TIMEOUT_MS,
} from "./r2";

type SendOptions = { requestTimeout: number; abortSignal: AbortSignal };

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    ALLOW_LIVE_STORAGE_IN_TESTS: "1",
    R2_ACCOUNT_ID: "account",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
  };
  sdk.send.mockReset();
});
afterAll(() => {
  process.env = { ...originalEnv };
});

describe("R2 timeouts", () => {
  it("gives every attempt its own timeout, and makes it an error", async () => {
    sdk.send.mockResolvedValue({
      Body: { transformToString: async () => '{"ok":true}' },
    });
    await expect(getJsonObject("bucket", "key")).resolves.toEqual({
      ok: true,
    });
    expect(sdk.config).toMatchObject({
      maxAttempts: 3,
      requestHandler: {
        requestTimeout: R2_ATTEMPT_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      },
    });
    const options = sdk.send.mock.calls[0]![1] as SendOptions;
    expect(options.requestTimeout).toBe(R2_ATTEMPT_TIMEOUT_MS);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("keeps three attempts inside the overall bound for small requests", () => {
    expect(R2_ATTEMPT_TIMEOUT_MS * 3).toBeLessThan(R2_REQUEST_TIMEOUT_MS);
  });

  it("allows a large upload more time per attempt", async () => {
    sdk.send.mockResolvedValue({});
    await putBinaryObject(
      "bucket",
      "film.mp4",
      Buffer.alloc(20 * 2 ** 20),
      "video/mp4",
    );
    const options = sdk.send.mock.calls[0]![1] as SendOptions;
    expect(options.requestTimeout).toBe(R2_ATTEMPT_TIMEOUT_MS + 20_000);
  });
});

describe("object info", () => {
  it("reports when an object was written, or null when it is missing", async () => {
    const lastModified = new Date("2026-09-24T08:06:45.000Z");
    sdk.send.mockResolvedValueOnce({ LastModified: lastModified });
    await expect(getObjectInfo("bucket", "poster.jpg")).resolves.toEqual({
      lastModified,
    });
    sdk.send.mockRejectedValueOnce(
      Object.assign(new Error("NotFound"), { name: "NotFound" }),
    );
    await expect(getObjectInfo("bucket", "missing.jpg")).resolves.toBeNull();
  });
});
