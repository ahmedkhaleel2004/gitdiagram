import type * as S3Sdk from "@aws-sdk/client-s3";
import type * as GcsSdk from "@google-cloud/storage";
import type { Storage as GcsStorage } from "@google-cloud/storage";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import {
  assertLiveStorageAllowedForTests,
  getObjectStorageProvider,
  readRequiredEnv,
} from "./config";

let client: S3Sdk.S3Client | null = null;
let s3ModulePromise: Promise<typeof S3Sdk> | null = null;
let gcsStorage: GcsStorage | null = null;
let gcsModulePromise: Promise<typeof GcsSdk> | null = null;
export const R2_REQUEST_TIMEOUT_MS = 10_000;

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface ObjectReadResult<T> {
  value: T;
  etag: string;
}

export type ObjectWriteCondition = { ifMatch: string } | { ifNoneMatch: true };

function requestOptions() {
  return { abortSignal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS) };
}

async function getClient() {
  const provider = getObjectStorageProvider();
  assertLiveStorageAllowedForTests(provider === "gcs" ? "GCS" : "R2");

  if (provider === "gcs") {
    gcsModulePromise ??= import("@google-cloud/storage");
    const gcs = await gcsModulePromise;
    gcsStorage ??= new gcs.Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT?.trim() || undefined,
    });
    return { provider, gcsStorage, gcs };
  }

  s3ModulePromise ??= import("@aws-sdk/client-s3");
  const s3 = await s3ModulePromise;

  client ??= new s3.S3Client({
    region: "auto",
    endpoint: `https://${readRequiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: readRequiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: readRequiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return { provider, client, s3 };
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return (
    code === 404 ||
    code === "404" ||
    error.name === "NoSuchKey" ||
    error.name === "NotFound" ||
    error.message.includes("NotFound") ||
    error.message.includes("NoSuchKey")
  );
}

export async function getJsonObject<T>(
  bucket: string,
  key: string,
): Promise<T | null> {
  try {
    const storage = await getClient();
    if (storage.provider === "gcs") {
      const [body] = await storage.gcsStorage
        .bucket(bucket)
        .file(key)
        .download();
      return JSON.parse(body.toString("utf8")) as T;
    }
    const { client: storageClient, s3 } = storage;
    const response = await storageClient.send(
      new s3.GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      requestOptions(),
    );

    const body = await response.Body?.transformToString();
    if (!body) {
      return null;
    }

    return JSON.parse(body) as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function putJsonObject(
  bucket: string,
  key: string,
  payload: unknown,
): Promise<void> {
  const storage = await getClient();
  if (storage.provider === "gcs") {
    await storage.gcsStorage.bucket(bucket).file(key).save(JSON.stringify(payload), {
      resumable: false,
      metadata: { contentType: "application/json" },
    });
    return;
  }
  const { client: storageClient, s3 } = storage;
  await storageClient.send(
    new s3.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(payload),
      ContentType: "application/json",
    }),
    requestOptions(),
  );
}

export async function getGzipJsonObject<T>(
  bucket: string,
  key: string,
): Promise<T | null> {
  try {
    const storage = await getClient();
    if (storage.provider === "gcs") {
      const [body] = await storage.gcsStorage
        .bucket(bucket)
        .file(key)
        .download({ decompress: false });
      if (!body.byteLength) return null;
      return JSON.parse((await gunzipAsync(body)).toString("utf8")) as T;
    }
    const { client: storageClient, s3 } = storage;
    const response = await storageClient.send(
      new s3.GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      requestOptions(),
    );

    const body = await response.Body?.transformToByteArray();
    if (!body?.byteLength) {
      return null;
    }

    const decompressed = await gunzipAsync(body);
    return JSON.parse(decompressed.toString("utf8")) as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getGzipJsonObjectWithEtag<T>(
  bucket: string,
  key: string,
): Promise<ObjectReadResult<T> | null> {
  try {
    const storage = await getClient();
    if (storage.provider === "gcs") {
      const file = storage.gcsStorage.bucket(bucket).file(key);
      const [[metadata], [body]] = await Promise.all([
        file.getMetadata(),
        file.download({ decompress: false }),
      ]);
      if (!body.byteLength) return null;
      if (!metadata.generation) throw new Error(`GCS object ${key} did not include a generation.`);
      const decompressed = await gunzipAsync(body);
      return {
        value: JSON.parse(decompressed.toString("utf8")) as T,
        etag: String(metadata.generation),
      };
    }
    const { client: storageClient, s3 } = storage;
    const response = await storageClient.send(
      new s3.GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      requestOptions(),
    );

    const body = await response.Body?.transformToByteArray();
    if (!body?.byteLength) {
      return null;
    }
    if (!response.ETag) {
      throw new Error(`R2 object ${key} did not include an ETag.`);
    }

    const decompressed = await gunzipAsync(body);
    return {
      value: JSON.parse(decompressed.toString("utf8")) as T,
      etag: response.ETag,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function putGzipJsonObject(
  bucket: string,
  key: string,
  payload: unknown,
  condition?: ObjectWriteCondition,
): Promise<void> {
  const [body, storage] = await Promise.all([
    gzipAsync(JSON.stringify(payload)),
    getClient(),
  ]);

  if (storage.provider === "gcs") {
    const preconditionOpts = condition && "ifMatch" in condition
      ? { ifGenerationMatch: condition.ifMatch }
      : condition && "ifNoneMatch" in condition
        ? { ifGenerationMatch: 0 }
        : undefined;
    await storage.gcsStorage.bucket(bucket).file(key).save(body, {
      resumable: false,
      metadata: { contentEncoding: "gzip", contentType: "application/json" },
      ...(preconditionOpts ? { preconditionOpts } : {}),
    });
    return;
  }
  const { client: storageClient, s3 } = storage;

  await storageClient.send(
    new s3.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentEncoding: "gzip",
      ContentType: "application/json",
      ...(condition && "ifMatch" in condition
        ? { IfMatch: condition.ifMatch }
        : {}),
      ...(condition && "ifNoneMatch" in condition ? { IfNoneMatch: "*" } : {}),
    }),
    requestOptions(),
  );
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  const storage = await getClient();
  if (storage.provider === "gcs") {
    await storage.gcsStorage.bucket(bucket).file(key).delete({ ignoreNotFound: true });
    return;
  }
  const { client: storageClient, s3 } = storage;
  await storageClient.send(
    new s3.DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    requestOptions(),
  );
}

export async function checkStorageBucket(bucket: string): Promise<void> {
  // Exercise the same authenticated GetObject path used by the application.
  // A missing sentinel is a successful readiness result; permission failures
  // and transport errors still propagate.
  await getJsonObject(
    bucket,
    "_meta/gitdiagram-readiness-sentinel-does-not-exist.json",
  );
}

export const checkR2Bucket = checkStorageBucket;
