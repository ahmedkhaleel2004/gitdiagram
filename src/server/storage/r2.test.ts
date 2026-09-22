import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fileMock, StorageMock } = vi.hoisted(() => {
  const file = {
    delete: vi.fn(),
    download: vi.fn(),
    getMetadata: vi.fn(),
    save: vi.fn(),
  };
  const bucket = { file: vi.fn(() => file) };
  const storage = { bucket: vi.fn(() => bucket) };
  const Storage = vi.fn(function Storage() {
    return storage;
  });
  return {
    fileMock: file,
    bucketMock: bucket,
    StorageMock: Storage,
  };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: StorageMock,
}));

import {
  getGzipJsonObject,
  getGzipJsonObjectWithEtag,
  getJsonObject,
  putGzipJsonObject,
} from "~/server/storage/r2";

describe("Google Cloud Storage provider", () => {
  beforeEach(() => {
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "gcs");
    vi.stubEnv("ALLOW_LIVE_STORAGE_IN_TESTS", "1");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses generation preconditions for atomic conditional writes", async () => {
    const payload = { version: 2 };
    await putGzipJsonObject("artifacts", "index.json.gz", payload, {
      ifMatch: "1042",
    });

    const [body, options] = fileMock.save.mock.calls[0]!;
    expect(JSON.parse(gunzipSync(body as Buffer).toString("utf8"))).toEqual(
      payload,
    );
    expect(options).toMatchObject({
      metadata: { contentEncoding: "gzip", contentType: "application/json" },
      preconditionOpts: { ifGenerationMatch: "1042" },
      resumable: false,
    });
  });

  it("uses a zero generation precondition for create-only writes", async () => {
    await putGzipJsonObject("artifacts", "index.json.gz", {}, {
      ifNoneMatch: true,
    });

    expect(fileMock.save.mock.calls[0]?.[1]).toMatchObject({
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  });

  it("reads compressed JSON and exposes the GCS generation as its etag", async () => {
    fileMock.getMetadata.mockResolvedValue([{ generation: "1042" }]);
    fileMock.download.mockResolvedValue([
      await import("node:zlib").then(({ gzipSync }) =>
        gzipSync(JSON.stringify({ version: 2 })),
      ),
    ]);

    await expect(
      getGzipJsonObjectWithEtag("artifacts", "index.json.gz"),
    ).resolves.toEqual({ value: { version: 2 }, etag: "1042" });
    expect(fileMock.download).toHaveBeenCalledWith({ decompress: false });
  });

  it("reads compressed JSON without automatic decompression", async () => {
    const { gzipSync } = await import("node:zlib");
    fileMock.download.mockResolvedValue([gzipSync('{"version":2}')]);

    await expect(getGzipJsonObject("artifacts", "index.json.gz"))
      .resolves.toEqual({ version: 2 });
    expect(fileMock.download).toHaveBeenCalledWith({ decompress: false });
  });

  it("treats a missing object as an empty result", async () => {
    fileMock.download.mockRejectedValue(Object.assign(new Error("missing"), { code: 404 }));

    await expect(getJsonObject("artifacts", "missing.json")).resolves.toBe(
      null,
    );
  });
});
