function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function assertLiveStorageAllowedForTests(service: string): void {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.ALLOW_LIVE_STORAGE_IN_TESTS !== "1"
  ) {
    throw new Error(
      `${service} access is disabled during tests. Mock the storage module or set ALLOW_LIVE_STORAGE_IN_TESTS=1 for an intentional live-storage test.`,
    );
  }
}

export function readRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

export type ObjectStorageProvider = "r2" | "gcs";

export function getObjectStorageProvider(): ObjectStorageProvider {
  const provider = process.env.OBJECT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "r2") return "r2";
  if (provider === "gcs") return "gcs";
  throw new Error(`Unsupported OBJECT_STORAGE_PROVIDER: ${provider}.`);
}

export function getObjectStorageBucket(kind: "public" | "private"): string {
  const provider = getObjectStorageProvider();
  const name =
    provider === "gcs"
      ? kind === "public"
        ? "GCS_PUBLIC_BUCKET"
        : "GCS_PRIVATE_BUCKET"
      : kind === "public"
        ? "R2_PUBLIC_BUCKET"
        : "R2_PRIVATE_BUCKET";
  return (
    readEnv(name) ??
    (provider === "gcs" ? readEnv("GCS_BUCKET_NAME") : undefined) ??
    readRequiredEnv(name)
  );
}
