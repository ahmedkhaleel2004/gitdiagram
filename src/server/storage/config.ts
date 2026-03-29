function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function readRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

export function hasR2Config(): boolean {
  return Boolean(
    readEnv("R2_ACCOUNT_ID") &&
      readEnv("R2_ACCESS_KEY_ID") &&
      readEnv("R2_SECRET_ACCESS_KEY") &&
      readEnv("R2_PUBLIC_BUCKET") &&
      readEnv("R2_PRIVATE_BUCKET"),
  );
}

export function hasUpstashConfig(): boolean {
  return Boolean(
    readEnv("UPSTASH_REDIS_REST_URL") && readEnv("UPSTASH_REDIS_REST_TOKEN"),
  );
}

export function assertStorageConfig(): void {
  readRequiredEnv("R2_ACCOUNT_ID");
  readRequiredEnv("R2_ACCESS_KEY_ID");
  readRequiredEnv("R2_SECRET_ACCESS_KEY");
  readRequiredEnv("R2_PUBLIC_BUCKET");
  readRequiredEnv("R2_PRIVATE_BUCKET");
  readRequiredEnv("CACHE_KEY_SECRET");
  readRequiredEnv("UPSTASH_REDIS_REST_URL");
  readRequiredEnv("UPSTASH_REDIS_REST_TOKEN");
}
