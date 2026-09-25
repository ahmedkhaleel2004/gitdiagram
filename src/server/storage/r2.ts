import type * as S3Sdk from "@aws-sdk/client-s3";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import { assertLiveStorageAllowedForTests, readRequiredEnv } from "./config";

let client: S3Sdk.S3Client | null = null;
let s3ModulePromise: Promise<typeof S3Sdk> | null = null;
/** The most one small R2 call may take, its retries included. */
export const R2_REQUEST_TIMEOUT_MS = 10_000;
/**
 * The most one attempt at a small request may take. The SDK makes up to three
 * attempts, and each gets its own timeout: a single stalled attempt used to
 * spend the whole budget, so a slow R2 answer failed the page outright.
 */
export const R2_ATTEMPT_TIMEOUT_MS = 3_000;
const R2_MAX_ATTEMPTS = 3;

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface ObjectReadResult<T> {
  value: T;
  etag: string;
}

export type ObjectWriteCondition = { ifMatch: string } | { ifNoneMatch: true };

/**
 * Per-call timeouts: one per attempt (a request body of `bytes`, such as an
 * MP4 upload, gets a second more per MB) and one over every attempt.
 */
function requestOptions(bytes = 0) {
  const attempt = R2_ATTEMPT_TIMEOUT_MS + Math.ceil(bytes / 2 ** 20) * 1_000;
  return {
    requestTimeout: attempt,
    abortSignal: AbortSignal.timeout(
      Math.max(R2_REQUEST_TIMEOUT_MS, attempt * R2_MAX_ATTEMPTS + 1_000),
    ),
  };
}

async function getClient() {
  assertLiveStorageAllowedForTests("R2");

  s3ModulePromise ??= import("@aws-sdk/client-s3");
  const s3 = await s3ModulePromise;

  client ??= new s3.S3Client({
    region: "auto",
    endpoint: `https://${readRequiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: readRequiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: readRequiredEnv("R2_SECRET_ACCESS_KEY"),
    },
    maxAttempts: R2_MAX_ATTEMPTS,
    requestHandler: {
      connectionTimeout: 2_000,
      requestTimeout: R2_ATTEMPT_TIMEOUT_MS,
      // Without this an attempt past its timeout only logs a warning.
      throwOnRequestTimeout: true,
    },
  });

  return { client, s3 };
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
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
    const { client: storageClient, s3 } = await getClient();
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
  const { client: storageClient, s3 } = await getClient();
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

export async function getBinaryObject(
  bucket: string,
  key: string,
): Promise<Buffer | null> {
  try {
    const { client: storageClient, s3 } = await getClient();
    const response = await storageClient.send(
      new s3.GetObjectCommand({ Bucket: bucket, Key: key }),
      requestOptions(),
    );
    const bytes = await response.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function putBinaryObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { client: storageClient, s3 } = await getClient();
  await storageClient.send(
    new s3.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
    requestOptions(body.byteLength),
  );
}

/** Every key under a prefix, with its last-modified time. */
export async function listObjects(
  bucket: string,
  prefix: string,
): Promise<Array<{ key: string; lastModified: Date | null }>> {
  const { client: storageClient, s3 } = await getClient();
  const objects: Array<{ key: string; lastModified: Date | null }> = [];
  let token: string | undefined;
  do {
    const page = await storageClient.send(
      new s3.ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
      requestOptions(),
    );
    for (const item of page.Contents ?? [])
      if (item.Key)
        objects.push({
          key: item.Key,
          lastModified: item.LastModified ?? null,
        });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

/** An object's last-modified time, or null if it does not exist. */
export async function getObjectInfo(
  bucket: string,
  key: string,
): Promise<{ lastModified: Date | null } | null> {
  try {
    const { client: storageClient, s3 } = await getClient();
    const response = await storageClient.send(
      new s3.HeadObjectCommand({ Bucket: bucket, Key: key }),
      requestOptions(),
    );
    return { lastModified: response.LastModified ?? null };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function hasObject(bucket: string, key: string): Promise<boolean> {
  return (await getObjectInfo(bucket, key)) !== null;
}

/** A short-lived signed GET URL that downloads the object under `filename`. */
export async function presignObjectDownload(
  bucket: string,
  key: string,
  options: { filename: string; expiresInSeconds: number },
): Promise<string> {
  const { client: storageClient, s3 } = await getClient();
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  return getSignedUrl(
    storageClient,
    new s3.GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${options.filename.replace(/[^\w.-]/g, "_")}"`,
    }),
    { expiresIn: options.expiresInSeconds },
  );
}

export async function getGzipJsonObject<T>(
  bucket: string,
  key: string,
): Promise<T | null> {
  try {
    const { client: storageClient, s3 } = await getClient();
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
    const { client: storageClient, s3 } = await getClient();
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
  const [body, { client: storageClient, s3 }] = await Promise.all([
    gzipAsync(JSON.stringify(payload)),
    getClient(),
  ]);

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
  const { client: storageClient, s3 } = await getClient();
  await storageClient.send(
    new s3.DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    requestOptions(),
  );
}

export async function checkR2Bucket(bucket: string): Promise<void> {
  // Exercise the same authenticated GetObject path used by the application.
  // A missing sentinel is a successful readiness result; permission failures
  // and transport errors still propagate.
  await getJsonObject(
    bucket,
    "_meta/gitdiagram-readiness-sentinel-does-not-exist.json",
  );
}
