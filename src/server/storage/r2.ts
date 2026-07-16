import type * as S3Sdk from "@aws-sdk/client-s3";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import { assertLiveStorageAllowedForTests, readRequiredEnv } from "./config";

let client: S3Sdk.S3Client | null = null;
let s3ModulePromise: Promise<typeof S3Sdk> | null = null;
export const R2_REQUEST_TIMEOUT_MS = 10_000;

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function requestOptions() {
  return { abortSignal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS) };
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

export async function putGzipJsonObject(
  bucket: string,
  key: string,
  payload: unknown,
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
    }),
    requestOptions(),
  );
}
