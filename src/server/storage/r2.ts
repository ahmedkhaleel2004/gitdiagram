import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { readRequiredEnv } from "./config";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) {
    return client;
  }

  client = new S3Client({
    region: "auto",
    endpoint: `https://${readRequiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: readRequiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: readRequiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return client;
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
    const response = await getClient().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
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
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(payload),
      ContentType: "application/json",
    }),
  );
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export async function objectExists(
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export interface ListedBucketObject {
  key: string;
  lastModified: string | null;
  size: number | null;
}

export async function listObjects(
  bucket: string,
  prefix: string,
): Promise<ListedBucketObject[]> {
  const objects: ListedBucketObject[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await getClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const entry of response.Contents ?? []) {
      if (!entry.Key) {
        continue;
      }

      objects.push({
        key: entry.Key,
        lastModified: entry.LastModified?.toISOString() ?? null,
        size: typeof entry.Size === "number" ? entry.Size : null,
      });
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return objects;
}
