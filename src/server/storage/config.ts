export type DiagramCacheBackend = "postgres" | "dual" | "object";
export type QuotaBackend = "postgres" | "upstash";

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

export function getDiagramCacheBackend(): DiagramCacheBackend {
  const value = readEnv("DIAGRAM_CACHE_BACKEND")?.toLowerCase();
  if (value === "postgres" || value === "dual" || value === "object") {
    return value;
  }
  return hasR2Config() ? "object" : "postgres";
}

export function getQuotaBackend(): QuotaBackend {
  const value = readEnv("QUOTA_BACKEND")?.toLowerCase();
  if (value === "postgres" || value === "upstash") {
    return value;
  }
  return hasUpstashConfig() ? "upstash" : "postgres";
}

export function isPostgresFallbackEnabled(): boolean {
  const value = readEnv("POSTGRES_FALLBACK_ENABLED")?.toLowerCase();
  if (!value) {
    return false;
  }
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function hasPostgresConfig(): boolean {
  return Boolean(readEnv("POSTGRES_URL"));
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
